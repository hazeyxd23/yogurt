import Spinner from "./Spinner";

export default function LoadingState({ label = "Loading..." }) {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-surface-muted">
      <Spinner className="h-4 w-4" />
      <span>{label}</span>
    </div>
  );
}
