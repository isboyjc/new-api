package plugins_test

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const mrAosoUpstreamVideo = "https://cdn.carrothub.example/private/result.mp4"

func TestMrAosoW3Video(t *testing.T) {
	source, err := builtinplugins.Source("mr-aoso")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "mr-aoso"})
	require.NoError(t, err)

	roundTrip := func(t *testing.T, value any) map[string]any {
		encoded, marshalErr := common.Marshal(value)
		require.NoError(t, marshalErr)
		var decoded map[string]any
		require.NoError(t, common.Unmarshal(encoded, &decoded))
		return decoded
	}
	submitCtx := func(model, upstream string, body map[string]any) map[string]any {
		return map[string]any{"model": model, "upstreamModel": upstream, "baseUrl": "https://api.mulerouter.ai", "apiKey": "k", "requestBody": body}
	}
	submit := func(t *testing.T, model, upstream string, body map[string]any) (map[string]any, error) {
		value, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", submitCtx(model, upstream, body))
		if callErr != nil {
			return nil, callErr
		}
		return roundTrip(t, value), nil
	}
	usage := func(t *testing.T, purpose, model, upstream string, body map[string]any) map[string]any {
		ctx := submitCtx(model, upstream, body)
		ctx["usagePurpose"] = purpose
		value, callErr := plugin.Engine.Call(t.Context(), "extractUsage", ctx)
		require.NoError(t, callErr)
		return roundTrip(t, value)
	}
	decodeVideo := func(t *testing.T, model, upstream string, body map[string]any) (map[string]any, error) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": model, "upstreamModel": upstream, "body": map[string]any{"kind": "json", "value": body},
		})
		if callErr != nil {
			return nil, callErr
		}
		return roundTrip(t, value), nil
	}
	decodeResponses := func(t *testing.T, model, upstream string, body map[string]any) (map[string]any, error) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "decodeRequest"}, map[string]any{
			"model": model, "upstreamModel": upstream, "stream": false, "body": map[string]any{"kind": "json", "value": body},
		})
		if callErr != nil {
			return nil, callErr
		}
		return roundTrip(t, value), nil
	}

	t.Run("every client surface submits the same vendor body to the model's own path", func(t *testing.T) {
		native, callErr := submit(t, "w3.0-video", "w3.0-video", map[string]any{"model": "w3.0-video", "prompt": "a cat"})
		require.NoError(t, callErr)
		assert.Equal(t, "https://api.mulerouter.ai/vendors/carrothub/v1/w3.0-video/generation", native["url"])
		assert.Equal(t, "text_to_video", native["action"])
		// Defaults come from the vendor contract, not from the client.
		assert.Equal(t, map[string]any{"prompt": "a cat", "resolution": "1080p", "ratio": "adaptive", "duration": float64(5)}, native["body"])

		video, callErr := decodeVideo(t, "w3.0-video", "w3.0-video", map[string]any{"model": "w3.0-video", "prompt": "a cat"})
		require.NoError(t, callErr)
		fromVideo, callErr := submit(t, "w3.0-video", "w3.0-video", video["requestBody"].(map[string]any))
		require.NoError(t, callErr)
		assert.Equal(t, native["body"], fromVideo["body"])

		responses, callErr := decodeResponses(t, "w3.0-video", "w3.0-video", map[string]any{"model": "w3.0-video", "input": "a cat"})
		require.NoError(t, callErr)
		fromResponses, callErr := submit(t, "w3.0-video", "w3.0-video", responses["requestBody"].(map[string]any))
		require.NoError(t, callErr)
		assert.Equal(t, native["body"], fromResponses["body"])
	})

	t.Run("the bearer scheme is added to the bare channel key", func(t *testing.T) {
		// resolveAuth puts the raw key in authHeader for an api_key plugin, so
		// forwarding it unchanged sends `Authorization: <key>` and upstream
		// answers 401 Invalid Authorization header format.
		ctx := submitCtx("w3.0-video", "w3.0-video", map[string]any{"prompt": "a cat"})
		ctx["authHeader"] = "sk-raw-key"
		ctx["apiKey"] = "sk-raw-key"
		value, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
		require.NoError(t, callErr)
		assert.Equal(t, "Bearer sk-raw-key", roundTrip(t, value)["headers"].(map[string]any)["Authorization"])

		queryCtx := map[string]any{"model": "w3.0-video", "upstreamModel": "w3.0-video", "baseUrl": "https://api.mulerouter.ai", "apiKey": "sk-raw-key", "authHeader": "sk-raw-key", "taskId": "abc"}
		value, callErr = plugin.Engine.Call(t.Context(), "buildQueryRequest", queryCtx)
		require.NoError(t, callErr)
		query := roundTrip(t, value)
		assert.Equal(t, "Bearer sk-raw-key", query["headers"].(map[string]any)["Authorization"])
		assert.Equal(t, "https://api.mulerouter.ai/vendors/carrothub/v1/w3.0-video/generation/abc", query["url"])

		// A host that already supplies a scheme is not double-prefixed.
		ctx["apiKey"] = ""
		ctx["authHeader"] = "Bearer sk-gateway"
		value, callErr = plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
		require.NoError(t, callErr)
		assert.Equal(t, "Bearer sk-gateway", roundTrip(t, value)["headers"].(map[string]any)["Authorization"])
	})

	t.Run("upstream parameters pass through the OpenAI video endpoint unchanged", func(t *testing.T) {
		resolved, callErr := decodeVideo(t, "w3.0-video", "w3.0-video", map[string]any{
			"model": "w3.0-video", "prompt": "reuse Image 1",
			"reference_images": []any{"https://cdn.example/a.png", "data:image/png;base64,AAAA"},
			"link":             "https://example.com/post",
			"ratio":            "9:16", "duration": 12, "audio": false, "prompt_extend": false, "seed": 7,
		})
		require.NoError(t, callErr)
		assert.Equal(t, "reference_to_video", resolved["action"])

		request, callErr := submit(t, "w3.0-video", "w3.0-video", resolved["requestBody"].(map[string]any))
		require.NoError(t, callErr)
		assert.Equal(t, map[string]any{
			"prompt":           "reuse Image 1",
			"reference_images": []any{"https://cdn.example/a.png", "data:image/png;base64,AAAA"},
			"link":             "https://example.com/post",
			"resolution":       "1080p", "ratio": "9:16", "duration": float64(12),
			"audio": false, "prompt_extend": false, "seed": float64(7),
		}, request["body"])
	})

	t.Run("OpenAI aliases map onto the vendor fields", func(t *testing.T) {
		resolved, callErr := decodeVideo(t, "w3.0-video", "w3.0-video", map[string]any{
			"model": "w3.0-video", "prompt": "a cat", "seconds": 8, "size": "1280x720", "input_reference": "https://cdn.example/first.png",
		})
		require.NoError(t, callErr)
		assert.Equal(t, "image_to_video", resolved["action"])

		request, callErr := submit(t, "w3.0-video", "w3.0-video", resolved["requestBody"].(map[string]any))
		require.NoError(t, callErr)
		body := request["body"].(map[string]any)
		assert.Equal(t, float64(8), body["duration"])
		assert.Equal(t, "720p", body["resolution"])
		assert.Equal(t, "16:9", body["ratio"])
		assert.Equal(t, "https://cdn.example/first.png", body["first_frame"])
		assert.NotContains(t, body, "size")
		assert.NotContains(t, body, "seconds")

		_, callErr = decodeVideo(t, "w3.0-video", "w3.0-video", map[string]any{"model": "w3.0-video", "prompt": "a cat", "size": "1000x1000"})
		require.ErrorContains(t, callErr, "invalid size")

		// The vendor's own quickstart posts a single picture as `image`.
		resolved, callErr = decodeVideo(t, "w3.0-video", "w3.0-video", map[string]any{
			"model": "w3.0-video", "prompt": "a cat", "image": "https://cdn.example/input.jpg",
		})
		require.NoError(t, callErr)
		request, callErr = submit(t, "w3.0-video", "w3.0-video", resolved["requestBody"].(map[string]any))
		require.NoError(t, callErr)
		assert.Equal(t, "https://cdn.example/input.jpg", request["body"].(map[string]any)["first_frame"])
	})

	t.Run("a multipart upload becomes a file placeholder the host inlines", func(t *testing.T) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "w3.0-video", "upstreamModel": "w3.0-video",
			"body": map[string]any{
				"kind":   "multipart",
				"fields": map[string]any{"model": []any{"w3.0-video"}, "prompt": []any{"a cat"}, "seconds": []any{"9"}, "audio": []any{"false"}},
				"files":  []any{map[string]any{"ref": "request_file:input_reference", "field": "input_reference", "mimeType": "image/png"}},
			},
		})
		require.NoError(t, callErr)
		request, callErr := submit(t, "w3.0-video", "w3.0-video", roundTrip(t, value)["requestBody"].(map[string]any))
		require.NoError(t, callErr)
		body := request["body"].(map[string]any)
		assert.Equal(t, float64(9), body["duration"])
		assert.Equal(t, false, body["audio"])
		assert.Equal(t, map[string]any{
			"__fileRef": "request_file:input_reference", "encoding": "dataUrl", "mimeType": "image/png", "maxBytes": float64(20971520),
		}, body["first_frame"])
	})

	t.Run("responses images become keyframes and overflow becomes references", func(t *testing.T) {
		imagePart := func(url string) any {
			return map[string]any{"type": "input_image", "image_url": url}
		}
		resolved, callErr := decodeResponses(t, "w3.0-video", "w3.0-video", map[string]any{
			"model": "w3.0-video", "input": []any{imagePart("https://cdn.example/a.png"), imagePart("https://cdn.example/b.png")},
		})
		require.NoError(t, callErr)
		requestBody := resolved["requestBody"].(map[string]any)
		assert.Equal(t, "https://cdn.example/a.png", requestBody["first_frame"])
		assert.Equal(t, "https://cdn.example/b.png", requestBody["last_frame"])

		resolved, callErr = decodeResponses(t, "w3.0-video", "w3.0-video", map[string]any{
			"model": "w3.0-video",
			"input": []any{imagePart("https://cdn.example/a.png"), imagePart("https://cdn.example/b.png"), imagePart("https://cdn.example/c.png")},
		})
		require.NoError(t, callErr)
		requestBody = resolved["requestBody"].(map[string]any)
		assert.Equal(t, []any{"https://cdn.example/a.png", "https://cdn.example/b.png", "https://cdn.example/c.png"}, requestBody["reference_images"])
		assert.NotContains(t, requestBody, "first_frame")
	})

	t.Run("input rules from the vendor contract are enforced", func(t *testing.T) {
		cases := []struct {
			name  string
			body  map[string]any
			match string
		}{
			{"keyframe and reference mixed", map[string]any{"first_frame": "https://cdn.example/a.png", "reference_images": []any{"https://cdn.example/b.png"}}, "cannot mix the keyframe mode"},
			{"file and link", map[string]any{"prompt": "a cat", "file": "https://example.com/a.pdf", "link": "https://example.com"}, "file and link cannot be combined"},
			{"file must be a URL", map[string]any{"prompt": "a cat", "file": "data:application/pdf;base64,AAAA"}, "file must be a public HTTP or HTTPS URL"},
			{"reference videos reject Base64", map[string]any{"prompt": "a cat", "reference_videos": []any{"data:video/mp4;base64,AAAA"}}, "Base64 is not accepted"},
			{"empty request", map[string]any{}, "prompt or at least one media input is required"},
			{"duration above the ceiling", map[string]any{"prompt": "a cat", "duration": 31}, "between 2 and 30"},
			{"duration below the floor", map[string]any{"prompt": "a cat", "duration": 1}, "between 2 and 30"},
			{"fractional duration", map[string]any{"prompt": "a cat", "duration": 5.5}, "between 2 and 30"},
			{"bailian random seed sentinel", map[string]any{"prompt": "a cat", "seed": -1}, "seed -1 is not supported"},
			{"seed above the ceiling", map[string]any{"prompt": "a cat", "seed": 2147483648}, "seed must be an integer"},
			{"unknown ratio", map[string]any{"prompt": "a cat", "ratio": "21:9"}, "ratio must be one of"},
			{"unknown model", map[string]any{"prompt": "a cat"}, "unsupported model"},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				upstream := "w3.0-video"
				if tc.name == "unknown model" {
					upstream = "w4.0-video"
				}
				_, callErr := submit(t, "w3.0-video", upstream, tc.body)
				require.ErrorContains(t, callErr, tc.match)
			})
		}

		images := make([]any, 11)
		for i := range images {
			images[i] = "https://cdn.example/a.png"
		}
		_, callErr := submit(t, "w3.0-video", "w3.0-video", map[string]any{"reference_images": images})
		require.ErrorContains(t, callErr, "reference_images accepts at most 10 items")
	})

	t.Run("resolution tiers follow the pinned upstream model", func(t *testing.T) {
		_, callErr := submit(t, "w3.0-video", "w3.0-video", map[string]any{"prompt": "a cat", "resolution": "2k"})
		require.ErrorContains(t, callErr, "w3.0-video resolution must be one of 480p, 720p, 1080p")

		_, callErr = submit(t, "w3.0-video-pro", "w3.0-video-pro", map[string]any{"prompt": "a cat", "resolution": "480p"})
		require.ErrorContains(t, callErr, "w3.0-video-pro resolution must be one of 1080p, 2k, 4k")

		// A channel alias is billed under its own name but validated, routed and
		// priced by the upstream model it maps to.
		request, callErr := submit(t, "wan3-video-spicy", "w3.0-video-pro", map[string]any{"model": "wan3-video-spicy", "prompt": "a cat", "resolution": "4K"})
		require.NoError(t, callErr)
		assert.Equal(t, "https://api.mulerouter.ai/vendors/carrothub/v1/w3.0-video-pro/generation", request["url"])
		assert.Equal(t, "4k", request["body"].(map[string]any)["resolution"])
	})

	t.Run("billable seconds reserve the ceiling when the length is not fixed", func(t *testing.T) {
		cases := []struct {
			name    string
			body    map[string]any
			seconds float64
		}{
			{"explicit duration", map[string]any{"prompt": "a cat", "duration": 8}, 8},
			{"default duration", map[string]any{"prompt": "a cat"}, 5},
			{"smart duration", map[string]any{"prompt": "a cat", "duration": -1}, 30},
			{"reference video input is billed too", map[string]any{"prompt": "a cat", "reference_videos": []any{"https://cdn.example/a.mp4"}, "duration": 5}, 30},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				facts := usage(t, "facts", "w3.0-video", "w3.0-video", tc.body)
				assert.Equal(t, map[string]any{"seconds": tc.seconds, "resolution": "1080p"}, facts)
			})
		}

		ratios := usage(t, "billing_ratios", "w3.0-video", "w3.0-video", map[string]any{"prompt": "a cat", "duration": 6, "resolution": "720p"})
		assert.Equal(t, float64(6), ratios["seconds"])
		assert.InDelta(t, 2.0, ratios["resolution-720p"], 1e-9)

		ratios = usage(t, "billing_ratios", "w3.0-video-prime-pro", "w3.0-video-prime-pro", map[string]any{"prompt": "a cat", "resolution": "4k"})
		assert.InDelta(t, 0.31/0.26, ratios["resolution-4k"], 1e-9)
	})

	t.Run("task status covers every documented spelling", func(t *testing.T) {
		cases := []struct {
			reported string
			status   string
		}{
			{"queued", "QUEUED"},
			{"pending", "QUEUED"},
			{"running", "IN_PROGRESS"},
			{"processing", "IN_PROGRESS"},
			{"retrying", "IN_PROGRESS"},
		}
		for _, tc := range cases {
			t.Run(tc.reported, func(t *testing.T) {
				value, callErr := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{},
					map[string]any{"task_info": map[string]any{"id": "t", "status": tc.reported}})
				require.NoError(t, callErr)
				assert.Equal(t, tc.status, roundTrip(t, value)["status"])
			})
		}

		for _, succeeded := range []string{"succeeded", "completed"} {
			value, callErr := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{},
				map[string]any{"task_info": map[string]any{"id": "t", "status": succeeded}, "videos": []any{mrAosoUpstreamVideo}})
			require.NoError(t, callErr)
			result := roundTrip(t, value)
			assert.Equal(t, "SUCCESS", result["status"])
			assert.Equal(t, mrAosoUpstreamVideo, result["url"])
		}

		// The lookup itself succeeds with HTTP 200, so the host cannot classify
		// a failed task from the transport status.
		value, callErr := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, map[string]any{
			"task_info": map[string]any{"id": "t", "status": "failed"},
			"error":     map[string]any{"error_code": 3005, "title": "External service execution failed", "detail": "prompt violation"},
		})
		require.NoError(t, callErr)
		result := roundTrip(t, value)
		assert.Equal(t, "FAILURE", result["status"])
		assert.Equal(t, "[3005] External service execution failed: prompt violation", result["reason"])

		value, callErr = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{},
			map[string]any{"task_info": map[string]any{"id": "t", "status": "succeeded"}})
		require.NoError(t, callErr)
		assert.Equal(t, "FAILURE", roundTrip(t, value)["status"])

		value, callErr = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{},
			map[string]any{"task_info": map[string]any{"id": "t", "status": "sleeping"}})
		require.NoError(t, callErr)
		assert.Equal(t, "UNKNOWN", roundTrip(t, value)["status"])

		// The endpoint reference documents videos[], the shared call-flow page
		// documents output.url; a result in either place is a result.
		value, callErr = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, map[string]any{
			"task_info": map[string]any{"id": "t", "status": "completed"},
			"output":    map[string]any{"url": mrAosoUpstreamVideo},
		})
		require.NoError(t, callErr)
		result = roundTrip(t, value)
		assert.Equal(t, "SUCCESS", result["status"])
		assert.Equal(t, mrAosoUpstreamVideo, result["url"])
	})

	t.Run("submission accepts a created task and rejects a rejected one", func(t *testing.T) {
		value, callErr := plugin.Engine.Call(t.Context(), "parseSubmitResponse",
			submitCtx("w3.0-video", "w3.0-video", map[string]any{"prompt": "a cat"}),
			map[string]any{"body": map[string]any{"task_info": map[string]any{"id": "upstream-uuid", "status": "pending"}}})
		require.NoError(t, callErr)
		assert.Equal(t, "upstream-uuid", roundTrip(t, value)["taskId"])

		// A rejected payload arrives as HTTP 400 with the envelope, and the host
		// hands every status code to the hook.
		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse",
			submitCtx("w3.0-video", "w3.0-video", map[string]any{"prompt": "a cat"}),
			map[string]any{"statusCode": 400, "body": map[string]any{"task_info": map[string]any{
				"id": "upstream-uuid", "status": "failed",
				"error": map[string]any{"code": 2001, "title": "Invalid Request", "detail": "cannot mix the reference mode"},
			}}})
		require.ErrorContains(t, callErr, "[2001] Invalid Request: cannot mix the reference mode")

		// An upstream failure with no envelope at all still has to fail loudly.
		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse",
			submitCtx("w3.0-video", "w3.0-video", map[string]any{"prompt": "a cat"}),
			map[string]any{"statusCode": 502, "body": map[string]any{}})
		require.ErrorContains(t, callErr, "upstream returned HTTP 502")
	})

	// Captured from a real completed task: the envelope the poller persists.
	t.Run("the recorded upstream envelope yields a video artifact", func(t *testing.T) {
		var data map[string]any
		require.NoError(t, common.Unmarshal([]byte(`{
			"task_info": {
				"created_at": "2026-09-21T08:23:12.657134+00:00",
				"id": "247d09f1-b643-4219-ac7b-d945a3876faa",
				"status": "completed",
				"updated_at": "2026-09-21T08:25:03.870026+00:00"
			},
			"videos": ["https://mule-router-assets.muleusercontent.com/router_public/production/artifacts/carrothub/tasks/247d09f1/outputs/result_00.mp4"]
		}`), &data))

		value, callErr := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, data)
		require.NoError(t, callErr)
		assert.Equal(t, "SUCCESS", roundTrip(t, value)["status"])

		value, callErr = plugin.Engine.Call(t.Context(), "listArtifacts",
			map[string]any{"taskId": "task_public", "status": "SUCCESS", "action": "text_to_video", "data": data, "state": nil, "producerVersion": "1.0.0"})
		require.NoError(t, callErr)
		encoded, marshalErr := common.Marshal(value)
		require.NoError(t, marshalErr)
		assert.JSONEq(t, `[{"key":"video","type":"video"}]`, string(encoded), "a completed task must expose its video artifact")
	})

	t.Run("the upstream result URL stays inside the content request", func(t *testing.T) {
		data := map[string]any{"task_info": map[string]any{"id": "t", "status": "succeeded"}, "videos": []any{mrAosoUpstreamVideo}}

		value, callErr := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"status": "SUCCESS", "data": data})
		require.NoError(t, callErr)
		encoded, marshalErr := common.Marshal(value)
		require.NoError(t, marshalErr)
		assert.JSONEq(t, `[{"key":"video","type":"video"}]`, string(encoded))

		value, callErr = plugin.Engine.Call(t.Context(), "buildContentRequest",
			map[string]any{"artifactKey": "video", "data": data, "clientRequest": map[string]any{"method": "GET"}})
		require.NoError(t, callErr)
		content := roundTrip(t, value)
		assert.Equal(t, mrAosoUpstreamVideo, content["url"])
		assert.Equal(t, true, content["credentialless"])

		// The retrieve response is the one surface a client reads directly, so
		// it must not carry the vendor URL that identifies the channel source.
		value, callErr = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "render"}, map[string]any{},
			map[string]any{"task_id": "task_public", "status": "SUCCESS", "progress": "100%", "created_at": 1700000000, "updated_at": 1700000100, "data": data})
		require.NoError(t, callErr)
		rendered, marshalErr := common.Marshal(roundTrip(t, value))
		require.NoError(t, marshalErr)
		assert.NotContains(t, string(rendered), "carrothub")
		assert.False(t, strings.Contains(string(rendered), mrAosoUpstreamVideo))
		assert.Equal(t, "completed", roundTrip(t, value)["status"])
	})
}
