import { useEffect, useRef, useState } from "react";
import { GuitarIcon } from "../common/icons";

const SUBDIVISION_LABELS = {
  1: "Quarter notes",
  2: "Eighth notes",
  3: "Triplets",
  4: "Sixteenth notes",
};

function playClick(ctx, { frequency, gain, duration = 0.05 }) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.frequency.value = frequency;
  gainNode.gain.value = gain;
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start();
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}

export default function Metronome({ bpm, onBpmChange }) {
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(4);
  const [subdivisions, setSubdivisions] = useState(1);
  const [stressFirstBeat, setStressFirstBeat] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [flash, setFlash] = useState(null); // { isDownbeat: bool } | null

  const audioCtxRef = useRef(null);
  const intervalRef = useRef(null);
  const beatIndexRef = useRef(0);
  const subdivisionIndexRef = useRef(0);
  const flashTimeoutRef = useRef(null);

  const tick = () => {
    const isMainBeat = subdivisionIndexRef.current === 0;
    const isDownbeat = isMainBeat && beatIndexRef.current === 0;

    if (audioCtxRef.current) {
      if (isDownbeat && stressFirstBeat) {
        playClick(audioCtxRef.current, { frequency: 1200, gain: 0.35 });
      } else if (isMainBeat) {
        playClick(audioCtxRef.current, { frequency: 880, gain: 0.22 });
      } else {
        playClick(audioCtxRef.current, { frequency: 600, gain: 0.1 });
      }
    }

    if (isMainBeat) {
      setFlash({ isDownbeat });
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => setFlash(null), 100);
    }

    subdivisionIndexRef.current += 1;
    if (subdivisionIndexRef.current >= subdivisions) {
      subdivisionIndexRef.current = 0;
      beatIndexRef.current = (beatIndexRef.current + 1) % beatsPerMeasure;
    }
  };

  useEffect(() => {
    if (!isPlaying) return undefined;
    const msPerBeat = 60000 / bpm;
    const msPerSubdivision = msPerBeat / subdivisions;
    intervalRef.current = setInterval(tick, msPerSubdivision);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, bpm, subdivisions, beatsPerMeasure, stressFirstBeat]);

  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(flashTimeoutRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  const handleToggle = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    beatIndexRef.current = 0;
    subdivisionIndexRef.current = 0;
    setIsPlaying(true);
  };

  return (
    <div className="card">
      <h3 className="mb-4 flex items-center gap-2">
        <GuitarIcon className="h-5 w-5 text-guitar" />
        Metronome
      </h3>

      <div className="mb-5 flex items-center gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="label mb-0">BPM</span>
            <span className="text-2xl font-bold tabular-nums text-guitar">{bpm}</span>
          </div>
          <input
            type="range"
            min={40}
            max={200}
            value={bpm}
            onChange={(e) => onBpmChange(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-border accent-guitar"
          />
        </div>
        <input
          type="number"
          min={40}
          max={200}
          value={bpm}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onBpmChange(Math.min(200, Math.max(40, v)));
          }}
          className="input w-20 text-center"
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Beats per measure</label>
          <select
            value={beatsPerMeasure}
            onChange={(e) => setBeatsPerMeasure(Number(e.target.value))}
            className="input"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Subdivisions</label>
          <select value={subdivisions} onChange={(e) => setSubdivisions(Number(e.target.value))} className="input">
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {SUBDIVISION_LABELS[n]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pt-6 text-sm text-ink sm:pt-0 sm:self-end sm:pb-3">
          <input
            type="checkbox"
            checked={stressFirstBeat}
            onChange={(e) => setStressFirstBeat(e.target.checked)}
            className="h-5 w-5 rounded border-surface-border bg-surface accent-guitar"
          />
          Stress first beat
        </label>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleToggle}
          className={`btn min-w-[120px] text-white focus:ring-guitar ${
            isPlaying ? "bg-red-600 hover:bg-red-500" : "bg-guitar hover:bg-guitar-dark"
          }`}
        >
          {isPlaying ? "Stop" : "Play"}
        </button>
        <div
          data-testid="metronome-flash"
          className="h-14 w-14 rounded-xl border border-surface-border transition-colors duration-75"
          style={{
            backgroundColor: flash
              ? flash.isDownbeat && stressFirstBeat
                ? "#f97316"
                : "#fb923c66"
              : "var(--metronome-idle)",
          }}
        />
      </div>
    </div>
  );
}
