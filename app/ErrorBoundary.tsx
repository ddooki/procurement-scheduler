"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, copied: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught Client Exception:", error, errorInfo);
    this.setState({ errorInfo });
    
    // Save error logs into localStorage for persistent diagnosis
    try {
      const existingLogs = JSON.parse(localStorage.getItem("app_error_logs") || "[]");
      const newLog = {
        timestamp: new Date().toLocaleString("ko-KR"),
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      };
      existingLogs.unshift(newLog);
      localStorage.setItem("app_error_logs", JSON.stringify(existingLogs.slice(0, 20)));
    } catch (e) {
      console.error("Failed to save error log to localStorage", e);
    }
  }

  private handleCopyLog = () => {
    const { error, errorInfo } = this.state;
    const timestamp = new Date().toLocaleString("ko-KR");
    const logText = `[에러 발생 시간: ${timestamp}]\n[에러 메시지]: ${error?.message}\n\n[스택 트레이스]:\n${error?.stack}\n\n[컴포넌트 스택]:\n${errorInfo?.componentStack}`;
    
    navigator.clipboard.writeText(logText).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  public render() {
    if (this.state.hasError) {
      const timestamp = new Date().toLocaleString("ko-KR");
      return (
        <div style={{ padding: "30px", fontFamily: "sans-serif", backgroundColor: "#fff5f5", minHeight: "100vh", color: "#2d3748" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto", backgroundColor: "#ffffff", padding: "24px", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #feb2b2" }}>
            <h2 style={{ color: "#e53e3e", marginTop: 0, fontSize: "22px" }}>⚠️ 화면 오류가 발생했습니다 (자동 진단 로그 제공)</h2>
            <p style={{ fontSize: "14px", color: "#4a5568" }}>
              발생 시간: <strong>{timestamp}</strong>
            </p>

            <div style={{ backgroundColor: "#1a202c", color: "#68d391", padding: "16px", borderRadius: "8px", overflowX: "auto", fontSize: "13px", lineHeight: "1.5", marginBottom: "20px" }}>
              <strong>[에러 메시지]</strong>: {this.state.error?.message}
              <br /><br />
              <strong>[자세한 스택 정보]</strong>:
              <pre style={{ margin: "8px 0 0 0", color: "#e2e8f0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {this.state.error?.stack}
              </pre>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={this.handleCopyLog}
                style={{
                  backgroundColor: "#3182ce",
                  color: "#ffffff",
                  padding: "10px 18px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "14px"
                }}
              >
                {this.state.copied ? "✅ 에러 로그 복약 완료! (나에게 붙여넣기하세요)" : "📋 에러 로그 복사하기 (클릭 후 AI에게 전송)"}
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  backgroundColor: "#718096",
                  color: "#ffffff",
                  padding: "10px 18px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px"
                }}
              >
                🔄 페이지 새로고침
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
