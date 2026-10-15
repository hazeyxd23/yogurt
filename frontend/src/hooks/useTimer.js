import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Counts up in whole seconds. start() resumes from the current count (not 0),
 * pause() stops without resetting, stop() stops AND resets to 0, reset() goes
 * back to the initial value passed in (useful when "initial" isn't 0).
 */
export function useTimer(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);

  const stop = useCallback(() => {
    setIsRunning(false);
    setSeconds(0);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setSeconds(initialSeconds);
  }, [initialSeconds]);

  return { seconds, isRunning, start, pause, stop, reset };
}
