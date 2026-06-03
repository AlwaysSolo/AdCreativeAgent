import Link from "next/link";

export function StartOverLink({ projectId }: { projectId?: string }) {
  return (
    <Link
      className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
      href={projectId ? `/projects/${encodeURIComponent(projectId)}` : "/"}
    >
      Start over
    </Link>
  );
}
