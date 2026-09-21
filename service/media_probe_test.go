package service

import (
	"context"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mp4Fixture builds the smallest container carrying a duration: an ftyp box
// followed by a moov holding one mvhd.
func mp4Fixture(timescale, duration uint32) []byte {
	box := func(name string, payload []byte) []byte {
		header := make([]byte, 8)
		binary.BigEndian.PutUint32(header, uint32(8+len(payload)))
		copy(header[4:], name)
		return append(header, payload...)
	}
	mvhd := make([]byte, 0, 100)
	mvhd = append(mvhd, 0, 0, 0, 0)
	mvhd = append(mvhd, make([]byte, 8)...)
	scale := make([]byte, 8)
	binary.BigEndian.PutUint32(scale[:4], timescale)
	binary.BigEndian.PutUint32(scale[4:], duration)
	mvhd = append(mvhd, scale...)
	mvhd = append(mvhd, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00)
	mvhd = append(mvhd, make([]byte, 10+36+24)...)
	mvhd = append(mvhd, 0, 0, 0, 2)
	ftyp := box("ftyp", []byte("isom\x00\x00\x02\x00isomiso2mp41"))
	return append(ftyp, box("moov", box("mvhd", mvhd))...)
}

// rangeServer serves the fixture, optionally honoring range requests, and
// records how many requests the probe needed.
func rangeServer(t *testing.T, body []byte, honorRange bool) (*httptest.Server, *int) {
	t.Helper()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		rangeHeader := r.Header.Get("Range")
		if !honorRange || rangeHeader == "" {
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			_, _ = w.Write(body)
			return
		}
		var start, end int64
		if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if start >= int64(len(body)) {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if end >= int64(len(body)) {
			end = int64(len(body)) - 1
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(body)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[start : end+1])
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

// allowLoopbackProbes lets the probe reach a test server while the guard stays
// enabled everywhere else; the private-host case below keeps the default.
func allowLoopbackProbes(t *testing.T) {
	t.Helper()
	fetchSetting := system_setting.GetFetchSetting()
	original := *fetchSetting
	t.Cleanup(func() { *fetchSetting = original })
	fetchSetting.EnableSSRFProtection = false
	InitHttpClient()
}

func TestProbeMediaDuration(t *testing.T) {
	allowLoopbackProbes(t)

	t.Run("reads the duration from a range-serving origin", func(t *testing.T) {
		server, requests := rangeServer(t, mp4Fixture(1000, 2020), true)
		media, err := ProbeMediaDuration(context.Background(), server.URL+"/a.mp4", "", 15)
		require.NoError(t, err)
		assert.InDelta(t, 2.02, media.Seconds, 1e-9)
		assert.Positive(t, *requests)
	})

	t.Run("reads the duration when the origin ignores the range header", func(t *testing.T) {
		server, _ := rangeServer(t, mp4Fixture(600, 7200), false)
		media, err := ProbeMediaDuration(context.Background(), server.URL+"/b.mp4", "", 15)
		require.NoError(t, err)
		assert.InDelta(t, 12, media.Seconds, 1e-9)
	})

	t.Run("clamps a duration the caller cannot accept", func(t *testing.T) {
		// A malformed or hostile header can claim any length, so the bound is
		// the caller's, not the file's.
		server, _ := rangeServer(t, mp4Fixture(1, 4000000000), true)
		media, err := ProbeMediaDuration(context.Background(), server.URL+"/c.mp4", "", 15)
		require.NoError(t, err)
		assert.Equal(t, float64(15), media.Seconds)
	})

	t.Run("rejects what it cannot measure", func(t *testing.T) {
		server, _ := rangeServer(t, []byte("<html>not a video</html>"), true)
		_, err := ProbeMediaDuration(context.Background(), server.URL+"/d.mp4", "", 15)
		require.Error(t, err)

		_, err = ProbeMediaDuration(context.Background(), "", "", 15)
		require.Error(t, err)

		_, err = ProbeMediaDuration(context.Background(), "ftp://example.com/e.mp4", "", 15)
		require.Error(t, err)
	})

	t.Run("serves a repeated URL from the cache", func(t *testing.T) {
		server, requests := rangeServer(t, mp4Fixture(1000, 3500), true)
		url := server.URL + "/cached.mp4"
		first, err := ProbeMediaDuration(context.Background(), url, "", 15)
		require.NoError(t, err)
		after := *requests
		second, err := ProbeMediaDuration(context.Background(), url, "", 15)
		require.NoError(t, err)
		assert.Equal(t, first.Seconds, second.Seconds)
		assert.Equal(t, after, *requests, "a cached measurement issues no further requests")

		// The cache stores the measurement, not one caller's bound.
		tighter, err := ProbeMediaDuration(context.Background(), url, "", 2)
		require.NoError(t, err)
		assert.Equal(t, float64(2), tighter.Seconds)
	})
}

func TestProbeMediaDurationRejectsPrivateHosts(t *testing.T) {
	// The default posture must refuse a URL that resolves inside the network,
	// because the URL comes from whoever made the request.
	_, err := ProbeMediaDuration(context.Background(), "http://127.0.0.1:1/f.mp4", "", 15)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "media probe"))
}
