/**
 * Upload of a recording with byte progress. `fetch` cannot report upload progress, so the admin app uploads through
 * XMLHttpRequest (upload.onprogress); everything else stays on fetch. Same rules as the fetch path of AdminClient: no cookies
 * (withCredentials false), a hard time limit, and the raw response text back to the caller, which maps status codes to errors.
 */
export interface UploadRequest {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  timeoutMs: number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export type UploadOutcome = { kind: "response"; status: number; text: string } | { kind: "timeout" } | { kind: "network" };

export type Uploader = (req: UploadRequest) => Promise<UploadOutcome>;

export function xhrUploader(create: () => XMLHttpRequest = () => new XMLHttpRequest()): Uploader {
  return (req) =>
    new Promise<UploadOutcome>((resolve) => {
      const xhr = create();
      xhr.open("POST", req.url, true);
      xhr.withCredentials = false;
      xhr.timeout = req.timeoutMs;
      for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
      if (req.onProgress) {
        const report = req.onProgress;
        xhr.upload.onprogress = (e: ProgressEvent) => report(e.loaded, e.lengthComputable ? e.total : req.body.size);
      }
      xhr.onload = () => resolve({ kind: "response", status: xhr.status, text: typeof xhr.responseText === "string" ? xhr.responseText : "" });
      xhr.ontimeout = () => resolve({ kind: "timeout" });
      xhr.onerror = () => resolve({ kind: "network" });
      xhr.onabort = () => resolve({ kind: "network" });
      xhr.send(req.body);
    });
}
