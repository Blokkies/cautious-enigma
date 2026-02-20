const EXPORT_TYPES = [
  "full",
  "variances_nonserialized_up",
  "variances_nonserialized_down",
  "variances_serialized_up",
  "variances_serialized_down",
  "variances_all",
  "serials",
  "queries",
  "breakdowns",
  "verifications",
  "audit_log",
];

function extractFilename(contentDisposition: string | null, fallback: string): string {
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
    if (match) return match[1];
  }
  return fallback;
}

export async function downloadAllAsZip(
  eventId?: number,
  zipName = "stocktake_all_exports.zip",
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const total = EXPORT_TYPES.length;
  let done = 0;

  const results = await Promise.all(
    EXPORT_TYPES.map(async (type) => {
      const params = new URLSearchParams({ type, format: "xlsx" });
      if (eventId) params.set("eventId", String(eventId));

      try {
        const res = await fetch(`/api/supervisor/export?${params}`);
        if (!res.ok) return null;

        const blob = await res.blob();
        const filename = extractFilename(
          res.headers.get("Content-Disposition"),
          `stocktake_${type}.xlsx`
        );
        return { filename, blob };
      } catch {
        return null;
      } finally {
        done++;
        onProgress?.(done, total);
      }
    })
  );

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  let fileCount = 0;
  for (const result of results) {
    if (result) {
      zip.file(result.filename, result.blob);
      fileCount++;
    }
  }

  if (fileCount === 0) {
    throw new Error("No export data available");
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
