export type BackupPayload = {
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
};

export function downloadBackupFile(payload: BackupPayload) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-backup-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.json`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function readBackupFile(file: File): Promise<BackupPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = String(event.target?.result ?? "");
        const parsed = JSON.parse(text) as BackupPayload;

        if (!parsed || typeof parsed !== "object" || !parsed.data) {
          reject(new Error("Invalid backup file format."));
          return;
        }

        resolve(parsed);
      } catch {
        reject(new Error("Failed to read backup file."));
      }
    };

    reader.onerror = () => reject(new Error("Failed to read backup file."));
    reader.readAsText(file);
  });
}