package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/abema/go-mp4"
)

// Media probing reads the container header of a remote video so a task plugin
// can bill the seconds an upstream charges for an input or output clip, instead
// of reserving an unverifiable ceiling. The URL comes from a client request or
// an upstream result, so every fetch is SSRF-guarded, range-limited, and the
// parsed duration is clamped before it can reach quota arithmetic.

const (
	mediaProbeChunkSize   = 256 << 10
	mediaProbeMaxBytes    = 8 << 20
	mediaProbeTimeout     = 10 * time.Second
	mediaProbeCacheTTL    = 10 * time.Minute
	mediaProbeCacheMax    = 512
	MediaProbeMaxSeconds  = 3600
	mediaProbeMaxURLBytes = 2048
)

// ProbedMedia is the measured shape of one remote media object.
type ProbedMedia struct {
	Seconds float64 `json:"seconds"`
	Bytes   int64   `json:"bytes,omitempty"`
}

var (
	errMediaProbeUnsupported = errors.New("media probe: upstream does not support range requests")

	mediaProbeCacheMutex sync.Mutex
	mediaProbeCache      = map[string]mediaProbeCacheEntry{}
)

type mediaProbeCacheEntry struct {
	media     ProbedMedia
	expiresAt time.Time
}

// ProbeMediaDuration measures a remote video's duration in seconds. maxSeconds
// is the caller's own upper bound, normally the vendor limit for that input;
// the parsed value is clamped to it because a malformed or hostile container
// header can claim any duration at all.
func ProbeMediaDuration(ctx context.Context, rawURL, proxy string, maxSeconds float64) (ProbedMedia, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || len(rawURL) > mediaProbeMaxURLBytes {
		return ProbedMedia{}, errors.New("media probe: invalid URL")
	}
	if maxSeconds <= 0 || maxSeconds > MediaProbeMaxSeconds {
		maxSeconds = MediaProbeMaxSeconds
	}
	if cached, ok := lookupMediaProbeCache(rawURL); ok {
		return clampProbedMedia(cached, maxSeconds), nil
	}
	if err := ValidateSSRFProtectedFetchURL(rawURL); err != nil {
		return ProbedMedia{}, fmt.Errorf("media probe: %w", err)
	}

	client := GetSSRFProtectedHTTPClient()
	if strings.TrimSpace(proxy) != "" {
		proxied, err := GetHttpClientWithProxy(proxy)
		if err != nil {
			return ProbedMedia{}, fmt.Errorf("media probe: %w", err)
		}
		client = proxied
	}
	if client == nil {
		return ProbedMedia{}, errors.New("media probe: no http client")
	}

	// One retry keeps a single dropped connection from failing a request the
	// caller cannot otherwise fix; a URL that is genuinely unreachable or
	// unparsable simply fails twice.
	info, size, err := probeContainer(ctx, client, rawURL)
	if err != nil && ctx.Err() == nil {
		info, size, err = probeContainer(ctx, client, rawURL)
	}
	if err != nil {
		return ProbedMedia{}, err
	}
	if info.Timescale == 0 {
		return ProbedMedia{}, errors.New("media probe: container reports no timescale")
	}
	media := ProbedMedia{Seconds: float64(info.Duration) / float64(info.Timescale), Bytes: size}
	if media.Seconds < 0 || media.Seconds != media.Seconds {
		return ProbedMedia{}, errors.New("media probe: container reports an invalid duration")
	}
	storeMediaProbeCache(rawURL, media)
	return clampProbedMedia(media, maxSeconds), nil
}

func probeContainer(ctx context.Context, client *http.Client, rawURL string) (*mp4.ProbeInfo, int64, error) {
	probeCtx, cancel := context.WithTimeout(ctx, mediaProbeTimeout)
	defer cancel()
	reader := &httpRangeReader{ctx: probeCtx, client: client, url: rawURL, size: -1, chunks: map[int64][]byte{}}
	info, err := mp4.Probe(reader)
	if err != nil {
		return nil, 0, fmt.Errorf("media probe: %w", err)
	}
	return info, reader.size, nil
}

func clampProbedMedia(media ProbedMedia, maxSeconds float64) ProbedMedia {
	if media.Seconds > maxSeconds {
		common.SysError(fmt.Sprintf("media probe duration %.3fs exceeds the %.3fs bound; clamping", media.Seconds, maxSeconds))
		media.Seconds = maxSeconds
	}
	if media.Seconds < 0 {
		media.Seconds = 0
	}
	return media
}

func lookupMediaProbeCache(url string) (ProbedMedia, bool) {
	mediaProbeCacheMutex.Lock()
	defer mediaProbeCacheMutex.Unlock()
	entry, ok := mediaProbeCache[url]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(mediaProbeCache, url)
		return ProbedMedia{}, false
	}
	return entry.media, true
}

func storeMediaProbeCache(url string, media ProbedMedia) {
	mediaProbeCacheMutex.Lock()
	defer mediaProbeCacheMutex.Unlock()
	now := time.Now()
	if len(mediaProbeCache) >= mediaProbeCacheMax {
		for key, entry := range mediaProbeCache {
			if now.After(entry.expiresAt) {
				delete(mediaProbeCache, key)
			}
		}
		if len(mediaProbeCache) >= mediaProbeCacheMax {
			mediaProbeCache = map[string]mediaProbeCacheEntry{}
		}
	}
	mediaProbeCache[url] = mediaProbeCacheEntry{media: media, expiresAt: now.Add(mediaProbeCacheTTL)}
}

// httpRangeReader serves an MP4 parser from range requests, caching whole
// chunks so a parser that walks box headers does not issue one request per
// read. It stops once the fetched bytes reach the probe budget.
type httpRangeReader struct {
	ctx    context.Context
	client *http.Client
	url    string
	size   int64
	pos    int64
	loaded int64
	chunks map[int64][]byte
}

func (r *httpRangeReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.size >= 0 && r.pos >= r.size {
		return 0, io.EOF
	}
	chunkIndex := r.pos / mediaProbeChunkSize
	chunk, err := r.chunk(chunkIndex)
	if err != nil {
		return 0, err
	}
	offset := r.pos - chunkIndex*mediaProbeChunkSize
	if offset >= int64(len(chunk)) {
		return 0, io.EOF
	}
	n := copy(p, chunk[offset:])
	r.pos += int64(n)
	return n, nil
}

func (r *httpRangeReader) Seek(offset int64, whence int) (int64, error) {
	var target int64
	switch whence {
	case io.SeekStart:
		target = offset
	case io.SeekCurrent:
		target = r.pos + offset
	case io.SeekEnd:
		if r.size < 0 {
			if _, err := r.chunk(0); err != nil {
				return 0, err
			}
		}
		if r.size < 0 {
			return 0, errMediaProbeUnsupported
		}
		target = r.size + offset
	default:
		return 0, fmt.Errorf("media probe: invalid seek whence %d", whence)
	}
	if target < 0 {
		return 0, errors.New("media probe: negative seek")
	}
	r.pos = target
	return target, nil
}

func (r *httpRangeReader) chunk(index int64) ([]byte, error) {
	if chunk, ok := r.chunks[index]; ok {
		return chunk, nil
	}
	if r.loaded+mediaProbeChunkSize > mediaProbeMaxBytes {
		return nil, fmt.Errorf("media probe: exceeded the %d byte budget", mediaProbeMaxBytes)
	}
	start := index * mediaProbeChunkSize
	end := start + mediaProbeChunkSize - 1
	request, err := http.NewRequestWithContext(r.ctx, http.MethodGet, r.url, nil)
	if err != nil {
		return nil, fmt.Errorf("media probe: %w", err)
	}
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	request.Header.Set("Accept", "*/*")
	response, err := r.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("media probe: %w", err)
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusPartialContent:
		r.rememberSizeFromContentRange(response.Header.Get("Content-Range"))
	case http.StatusOK:
		// The origin ignored the range header, so the whole object arrives on
		// the first request; read only the budget and stop asking for more.
		return r.consumeWholeBody(response.Body)
	case http.StatusRequestedRangeNotSatisfiable:
		return nil, io.EOF
	default:
		return nil, fmt.Errorf("media probe: upstream returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, mediaProbeChunkSize))
	if err != nil {
		return nil, fmt.Errorf("media probe: %w", err)
	}
	r.loaded += int64(len(body))
	r.chunks[index] = body
	if r.size < 0 && int64(len(body)) < mediaProbeChunkSize {
		r.size = start + int64(len(body))
	}
	return body, nil
}

func (r *httpRangeReader) consumeWholeBody(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, mediaProbeMaxBytes))
	if err != nil {
		return nil, fmt.Errorf("media probe: %w", err)
	}
	r.loaded = int64(len(data))
	r.size = int64(len(data))
	for offset := int64(0); offset < int64(len(data)); offset += mediaProbeChunkSize {
		end := offset + mediaProbeChunkSize
		if end > int64(len(data)) {
			end = int64(len(data))
		}
		r.chunks[offset/mediaProbeChunkSize] = data[offset:end]
	}
	if len(data) == 0 {
		return nil, io.EOF
	}
	return r.chunks[r.pos/mediaProbeChunkSize], nil
}

func (r *httpRangeReader) rememberSizeFromContentRange(value string) {
	if r.size >= 0 {
		return
	}
	_, total, found := strings.Cut(value, "/")
	if !found {
		return
	}
	size, err := strconv.ParseInt(strings.TrimSpace(total), 10, 64)
	if err == nil && size > 0 {
		r.size = size
	}
}
