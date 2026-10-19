"""Frame validation, the 24/40-frame window plan, Vision API error handling and predictor scrubbing."""
from __future__ import annotations

import pytest
from conftest import FakeVision, frame, pack, payload

from carelens_agent.frames import InputRejected, check_cadence, jpeg_size, unpack, validate, window_plan, wipe
from carelens_agent.vision import (
    NEUTRAL_JPEG,
    VisionClient,
    VisionProtocolError,
    VisionRejected,
    VisionUnavailable,
    aggregate_drink,
    analyze,
    cluster_lifts,
    parse_fall,
)


def mv(frames: list[bytes]) -> list[memoryview]:
    return [memoryview(f) for f in frames]


def test_neutral_scrub_image_is_a_valid_small_jpeg():
    assert jpeg_size(NEUTRAL_JPEG) == (160, 120)
    assert jpeg_size(frame(3)) == (160, 120)
    assert jpeg_size(b"not a jpeg") is None
    assert jpeg_size(frame(1)[:-5]) is None


def test_unpack_validates_the_package_body_format():
    frames = [frame(i) for i in range(3)]
    assert [bytes(f) for f in unpack(pack(frames), 3)] == frames
    with pytest.raises(InputRejected):
        unpack(pack(frames), 4)
    with pytest.raises(InputRejected):
        unpack(pack(frames)[:-3], 3)


def test_window_plan_matches_the_contract():
    assert window_plan(24) == [(0, 23)]
    assert window_plan(40) == [(0, 23), (8, 31), (16, 39)]
    with pytest.raises(InputRejected):
        window_plan(16)


def test_validate_rejects_corrupt_or_inconsistent_media():
    p, frames = payload(24)
    assert validate(p, mv(frames)).cadence_status == "ok"
    swapped = list(frames)
    swapped[0], swapped[1] = swapped[1], swapped[0]
    with pytest.raises(InputRejected, match="hash"):
        validate(p, mv(swapped))
    with pytest.raises(InputRejected):
        validate(p, mv(frames[:23]))
    bad_dims = dict(p, frame_width=320)
    with pytest.raises(InputRejected, match="dimensions"):
        validate(bad_dims, mv(frames))


def test_cadence_gap_and_jitter_are_reported():
    assert check_cadence([i * 125 for i in range(24)], 40)[0] == "ok"
    assert check_cadence([0, 125, 300, 425], 40)[0] == "out_of_tolerance"
    status, _, hi, issues = check_cadence([0, 125, 500, 625], 40)
    assert (status, hi) == ("gap", 375) and "gap of 375 ms" in issues[0]


def test_wipe_zeroes_buffers():
    b = bytearray(b"secret-frame-bytes")
    wipe(b)
    assert set(b) == {0}


def test_24_frames_make_one_fall_request_and_one_object_request_then_a_scrub(vision: FakeVision):
    p, frames = payload(24)
    result, timings = analyze(p, mv(frames), VisionClient(vision.url, 5), "carelens_models_v1_20261018")
    paths = [(c["path"], c["count"]) for c in vision.calls]
    assert paths == [("/v1/fall-check", 24), ("/v1/object-check", 24), ("/v1/object-check", 1)]
    assert vision.calls[-1]["first"] == "neutral"  # the scrub frame, not a capture frame
    assert all(c["content_type"] == "application/octet-stream" for c in vision.calls)
    assert result["fall"]["aggregation"] == "single_request.v1"
    assert set(result["fall"]["requests"][0]) == {
        "frame_start", "frame_end", "t_start_ms", "t_end_ms", "score", "window_logits", "windows", "threshold", "alert", "status"}
    assert result["drink"]["requests"][0]["evidence"]["frames"] == 24
    assert "detections" not in str(result) and "server_ms" not in str(result)
    assert timings["scrubbed"] == 1.0


def test_40_frames_are_split_into_three_overlapping_24_frame_requests(vision: FakeVision):
    p, frames = payload(40)
    result, _ = analyze(p, mv(frames), VisionClient(vision.url, 5), "pkg")
    fall_calls = [c for c in vision.calls if c["path"] == "/v1/fall-check"]
    assert [(c["count"], c["first"]) for c in fall_calls] == [(24, "0"), (24, "8"), (24, "16")]
    reqs = result["fall"]["requests"]
    assert [(r["frame_start"], r["frame_end"], r["t_start_ms"], r["t_end_ms"]) for r in reqs] == [(0, 23, 0, 2875), (8, 31, 1000, 3875), (16, 39, 2000, 4875)]
    assert result["fall"]["aggregation"] == "max_request_score_overlapping.v1"
    assert result["fall"]["aggregate_score"] == max(r["score"] for r in reqs)
    assert len([c for c in vision.calls if c["path"] == "/v1/object-check" and c["count"] == 24]) == 3


def test_overlapping_drink_windows_count_one_lift_once_and_flag_cross_window_medicine(vision: FakeVision):
    vision.drink_labels = [
        {"label": "khong", "evidence": {"medicine_frames": 4, "medicine_handled": True}},
        {"label": "uong_nuoc", "evidence": {"cup_frames": 6, "lift_frame": 12, "cup_lifted_to_face": True}},
        {"label": "uong_nuoc", "evidence": {"cup_frames": 6, "lift_frame": 4, "cup_lifted_to_face": True}},
    ]
    p, frames = payload(40)
    result, _ = analyze(p, mv(frames), VisionClient(vision.url, 5), "pkg")
    d = result["drink"]
    assert (d["aggregate_label"], d["cross_window_review"], d["distinct_lift_frames"]) == ("uong_nuoc", True, [20])


def test_drink_aggregation_rules():
    req = lambda s, label, lift=None, handled=False: {"frame_start": s, "label": label, "evidence": {"lift_frame": lift, "cup_lifted_to_face": lift is not None, "medicine_handled": handled}}  # noqa: E731
    assert aggregate_drink([req(0, "uong_thuoc", 3, True), req(8, "uong_nuoc", 2)])["aggregate_label"] == "uong_thuoc"
    assert aggregate_drink([req(0, "uong_thuoc", 3, True)])["cross_window_review"] is False
    assert cluster_lifts([3, 4, 9, 30, 33]) == [3, 9, 30]


def test_cadence_gap_skips_inference_and_says_why(vision: FakeVision):
    offsets = [i * 125 + (250 if i > 10 else 0) for i in range(24)]
    p, frames = payload(24, offsets=offsets)
    result, _ = analyze(p, mv(frames), VisionClient(vision.url, 5), "pkg")
    assert result["fall"] == {"status": "skipped", "reason": "cadence_gap", "aggregation": None, "aggregate_score": None, "requests": []}
    assert result["drink"]["status"] == "skipped"
    assert [c for c in vision.calls] == []


@pytest.mark.parametrize(("mode", "error"), [("http500", VisionUnavailable), ("http400", VisionRejected), ("malformed", VisionProtocolError)])
def test_vision_errors_are_never_turned_into_results(vision: FakeVision, mode, error):
    vision.mode = mode
    p, frames = payload(24)
    with pytest.raises(error):
        analyze(p, mv(frames), VisionClient(vision.url, 5), "pkg")


def test_timeout_is_unavailable_and_unreachable_is_unavailable(vision: FakeVision):
    vision.mode = "slow"
    p, frames = payload(24)
    with pytest.raises(VisionUnavailable):
        analyze(p, mv(frames), VisionClient(vision.url, 0.5), "pkg")
    with pytest.raises(VisionUnavailable):
        VisionClient("http://127.0.0.1:9", 0.5).health()


def test_scrub_runs_even_when_a_drink_request_fails(vision: FakeVision):
    p, frames = payload(24)
    client = VisionClient(vision.url, 5)
    original = client.post
    calls = {"n": 0}

    def flaky(path, fr):
        if path == "/v1/object-check":
            calls["n"] += 1
            raise VisionUnavailable("boom")
        return original(path, fr)

    client.post = flaky  # type: ignore[method-assign]
    with pytest.raises(VisionUnavailable):
        analyze(p, mv(frames), client, "pkg")
    assert vision.calls[-1]["first"] == "neutral"


def test_parse_fall_rejects_inconsistent_scores():
    good = {"score": -1.0, "window_logits": [[-2.0, -1.0]] * 3, "windows": 2, "threshold": None, "alert": None, "status": "NOT_CALIBRATED"}
    assert parse_fall(good, 2)["score"] == -1.0
    with pytest.raises(VisionProtocolError):
        parse_fall(dict(good, score=5.0), 2)
    with pytest.raises(VisionProtocolError):
        parse_fall(dict(good, windows=1), 2)
    with pytest.raises(VisionProtocolError):
        parse_fall(dict(good, score=float("nan")), 2)
