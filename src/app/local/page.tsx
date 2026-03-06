"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import mermaid from "mermaid";

interface StreamMessage {
  status: string;
  message?: string;
  chunk?: string;
  diagram?: string;
  explanation?: string;
  error?: string;
}

export default function LocalAnalysisPage() {
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [diagram, setDiagram] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (diagram && diagramRef.current) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
      });
      diagramRef.current.innerHTML = "";
      mermaid
        .render("mermaid-diagram", diagram)
        .then(({ svg }) => {
          if (diagramRef.current) {
            diagramRef.current.innerHTML = svg;
          }
        })
        .catch((err) => {
          if (diagramRef.current) {
            diagramRef.current.innerHTML = `<pre style="color: #f87171;">Mermaid render error: ${String(err)}</pre><pre style="color: #9ca3af; margin-top: 1rem;">${diagram}</pre>`;
          }
        });
    }
  }, [diagram]);

  const startAnalysis = useCallback(async () => {
    setStatus("running");
    setLogs([]);
    setDiagram(null);
    setExplanation("");
    setError(null);
    addLog("Starting local analysis...");

    try {
      const response = await fetch("/api/generate/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6)) as StreamMessage;

            if (msg.message) {
              addLog(msg.message);
            }

            if (msg.status === "explanation_chunk" && msg.chunk) {
              setExplanation((prev) => prev + msg.chunk);
            }

            if (msg.status === "complete" && msg.diagram) {
              setDiagram(msg.diagram);
              setStatus("complete");
              addLog("Analysis complete!");
            }

            if (msg.status === "error") {
              setError(msg.error ?? "Unknown error");
              setStatus("error");
              addLog(`Error: ${msg.error}`);
            }
          } catch {
            // skip parse errors
          }
        }
      }

      if (status !== "complete" && status !== "error") {
        setStatus("complete");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStatus("error");
      addLog(`Fatal error: ${msg}`);
    }
  }, [addLog, status]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#e5e5e5",
        fontFamily: "monospace",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
        GitDiagram - Local Analysis
      </h1>

      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={startAnalysis}
          disabled={status === "running"}
          style={{
            padding: "0.75rem 1.5rem",
            background: status === "running" ? "#333" : "#7c3aed",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: status === "running" ? "not-allowed" : "pointer",
            fontSize: "1rem",
          }}
        >
          {status === "running"
            ? "Analyzing..."
            : status === "complete"
              ? "Re-analyze"
              : "Start Analysis"}
        </button>
        <span style={{ marginLeft: "1rem", color: "#888" }}>
          Path: {process.env.NEXT_PUBLIC_LOCAL_PATH ?? "(configured in .env)"}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: "1rem",
            background: "#1a0000",
            border: "1px solid #f87171",
            borderRadius: "6px",
            marginBottom: "1rem",
            color: "#f87171",
          }}
        >
          {error}
        </div>
      )}

      {/* Logs panel */}
      <div
        style={{
          background: "#111",
          border: "1px solid #333",
          borderRadius: "6px",
          padding: "1rem",
          maxHeight: "200px",
          overflowY: "auto",
          marginBottom: "1rem",
          fontSize: "0.85rem",
        }}
      >
        {logs.length === 0 ? (
          <span style={{ color: "#666" }}>
            Click &quot;Start Analysis&quot; to begin...
          </span>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ color: "#a3a3a3" }}>
              {log}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Diagram */}
      {diagram && (
        <div
          style={{
            background: "#111",
            border: "1px solid #333",
            borderRadius: "6px",
            padding: "1rem",
            overflow: "auto",
          }}
        >
          <h2
            style={{
              fontSize: "1.1rem",
              marginBottom: "1rem",
              color: "#a78bfa",
            }}
          >
            Generated Diagram
          </h2>
          <div ref={diagramRef} />
        </div>
      )}

      {/* Explanation */}
      {explanation && (
        <details
          style={{
            marginTop: "1rem",
            background: "#111",
            border: "1px solid #333",
            borderRadius: "6px",
            padding: "1rem",
          }}
        >
          <summary
            style={{ cursor: "pointer", color: "#a78bfa" }}
          >
            View Explanation
          </summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              color: "#a3a3a3",
              marginTop: "0.5rem",
              fontSize: "0.85rem",
            }}
          >
            {explanation}
          </pre>
        </details>
      )}
    </div>
  );
}
