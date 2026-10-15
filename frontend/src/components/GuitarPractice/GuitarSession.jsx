import { useState } from "react";
import Metronome from "./Metronome";
import ScaleGenerator, { CustomScaleSelection } from "./ScaleGenerator";
import { useTimer } from "../../hooks/useTimer";
import { createGuitarSession } from "../../services/api";
import { useToast } from "../../context/ToastContext";
import Spinner from "../common/Spinner";
import ErrorMessage from "../common/ErrorMessage";

/**
 * Lays out the practice area: scale generator beside the metronome + session timer,
 * the custom key selection underneath, then `aside` (the stats panel).
 */
export default function GuitarSession({ onSaved, aside }) {
  const [bpm, setBpm] = useState(120);
  const [notes, setNotes] = useState("");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const timer = useTimer(0);
  const { showToast } = useToast();

  const handleStartSession = () => {
    setSessionStarted(true);
    setError(null);
    timer.reset();
    timer.start();
  };

  const handleStopAndSave = async () => {
    timer.pause();
    setSaving(true);
    setError(null);
    try {
      const minutes = Math.max(1, Math.round(timer.seconds / 60));
      const created = await createGuitarSession(minutes, bpm, notes || null);
      showToast(`Guitar session saved - ${minutes} min at ${bpm} BPM`);
      setSessionStarted(false);
      setNotes("");
      timer.stop();
      onSaved?.(created);
    } catch (err) {
      setError("Couldn't save the session. Please try again.");
      showToast("Failed to save guitar session", "error");
    } finally {
      setSaving(false);
    }
  };

  const mm = String(Math.floor(timer.seconds / 60)).padStart(2, "0");
  const ss = String(timer.seconds % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScaleGenerator />

        <div className="flex flex-col gap-6">
          <Metronome bpm={bpm} onBpmChange={setBpm} />

          <div className="card">
            <h3 className="mb-3">Session Timer</h3>
            <p className="mb-4 text-center text-5xl font-bold tabular-nums text-ink">
              {mm}:{ss}
            </p>

            <textarea
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input mb-4 resize-none"
            />

            {!sessionStarted ? (
              <button onClick={handleStartSession} className="btn-primary w-full">
                Start Session
              </button>
            ) : (
              <div className="flex gap-3">
                <button onClick={timer.isRunning ? timer.pause : timer.start} className="btn-secondary">
                  {timer.isRunning ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={handleStopAndSave}
                  disabled={saving}
                  className="btn flex-1 bg-guitar text-white hover:bg-guitar-dark focus:ring-guitar"
                >
                  {saving && <Spinner className="h-4 w-4" />}
                  {saving ? "Saving..." : "Stop & Save"}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-3">
                <ErrorMessage message={error} />
              </div>
            )}
          </div>
        </div>
      </div>

      <CustomScaleSelection />
      {aside}
    </div>
  );
}
