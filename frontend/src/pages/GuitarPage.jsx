import { useState } from "react";
import GuitarSession from "../components/GuitarPractice/GuitarSession";
import GuitarStats from "../components/GuitarPractice/GuitarStats";

export default function GuitarPage() {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div>
      <GuitarSession
        onSaved={() => setRefreshToken((t) => t + 1)}
        aside={<GuitarStats refreshToken={refreshToken} />}
      />
    </div>
  );
}
