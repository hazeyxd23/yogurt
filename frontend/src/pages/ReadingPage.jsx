import { useCallback, useEffect, useState } from "react";
import Library from "../components/Reading/Library";
import ReadingStats from "../components/Reading/ReadingStats";
import { getBooks, isCancel } from "../services/api";
import LoadingState from "../components/common/LoadingState";
import ErrorMessage from "../components/common/ErrorMessage";

export default function ReadingPage() {
  const [books, setBooks] = useState(null);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadBooks = useCallback(async (signal) => {
    try {
      setBooks(await getBooks(signal));
      setError(null);
    } catch (err) {
      if (!isCancel(err)) setError("Couldn't load your books. Is the backend running?");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadBooks(controller.signal);
    return () => controller.abort();
  }, [loadBooks, refreshToken]);

  const bump = () => setRefreshToken((t) => t + 1);

  return (
    <div>
      {error && (
        <div className="mb-6">
          <ErrorMessage message={error} />
        </div>
      )}
      {books === null ? (
        <div className="card">
          <LoadingState label="Loading books..." />
        </div>
      ) : (
        <>
          <Library books={books} onChanged={bump} />
          <div className="mt-6">
            <ReadingStats refreshToken={refreshToken} />
          </div>
        </>
      )}
    </div>
  );
}
