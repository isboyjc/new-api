package jsplugin

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/logger"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/service"
)

// A plugin that bills for the seconds inside an input or output clip cannot
// measure one itself, so it names the media it needs and the host measures it.
// Probing is best effort: a plugin must keep working when a measurement is
// missing, normally by reserving its own safe bound instead.
const (
	maxProbedMedia = 8
	// Probing runs inside the client's submit request, so the whole set shares
	// one budget rather than each URL owning the per-probe timeout.
	probeMediaBudget = 15 * time.Second
)

type probeMediaRequest struct {
	Key        string  `json:"key"`
	URL        string  `json:"url"`
	MaxSeconds float64 `json:"maxSeconds"`
}

// probeDeclaredMedia asks the plugin which media to measure, measures it, and
// returns the map the driver context exposes as ctx.media. A plugin that does
// not declare the capability, does not export the hook, or names nothing gets
// no map at all.
func (a *TaskAdaptor) probeDeclaredMedia(ctx context.Context, hookContext map[string]any) map[string]any {
	if !slices.Contains(a.plugin.Meta.RequiredCapabilities, pluginruntime.CapabilityMediaProbe) {
		return nil
	}
	if !a.hasHook(ctx, "listProbeMedia") {
		return nil
	}
	value, err := a.plugin.Engine.Call(ctx, "listProbeMedia", hookContext)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("task_plugin subsystem=media_probe event=list_failed plugin=%q reason=%v", a.plugin.Meta.Key, err))
		return nil
	}
	var requests []probeMediaRequest
	if err = convert(value, &requests); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("task_plugin subsystem=media_probe event=list_invalid plugin=%q", a.plugin.Meta.Key))
		return nil
	}
	if len(requests) == 0 {
		return nil
	}
	if len(requests) > maxProbedMedia {
		requests = requests[:maxProbedMedia]
	}
	proxy := ""
	if a.info != nil && a.info.HasChannelMeta() {
		proxy = a.info.ChannelSetting.Proxy
	}
	budgetCtx, cancel := context.WithTimeout(ctx, probeMediaBudget)
	defer cancel()
	// Each measurement costs a round trip or two against the origin, so one
	// slow clip must not spend the budget the rest of the set needs.
	var mutex sync.Mutex
	var group sync.WaitGroup
	probed := make(map[string]any, len(requests))
	for _, request := range requests {
		if !taskArtifactKeyPattern.MatchString(request.Key) {
			logger.LogWarn(ctx, fmt.Sprintf("task_plugin subsystem=media_probe event=invalid_key plugin=%q", a.plugin.Meta.Key))
			continue
		}
		group.Go(func() {
			media, probeErr := service.ProbeMediaDuration(budgetCtx, request.URL, proxy, request.MaxSeconds)
			if probeErr != nil {
				// The plugin falls back to its own bound; never bill zero
				// seconds for media that could not be measured.
				logger.LogWarn(ctx, fmt.Sprintf("task_plugin subsystem=media_probe event=probe_failed plugin=%q key=%q reason=%v", a.plugin.Meta.Key, request.Key, probeErr))
				return
			}
			mutex.Lock()
			defer mutex.Unlock()
			probed[request.Key] = map[string]any{"seconds": media.Seconds, "bytes": media.Bytes}
		})
	}
	group.Wait()
	if len(probed) == 0 {
		return nil
	}
	return probed
}

// completionProbeContext presents the terminal response as the context's data,
// so a plugin names the media it wants measured the same way on both sides.
func completionProbeContext(queryContext map[string]any, body any) map[string]any {
	probeContext := make(map[string]any, len(queryContext)+1)
	for key, value := range queryContext {
		probeContext[key] = value
	}
	probeContext["data"] = body
	return probeContext
}
