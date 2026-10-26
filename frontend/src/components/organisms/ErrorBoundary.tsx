import React from "react";
import { AlertCircle } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-4 stroke-[1.5] text-red-500" />
              <h2 className="text-heading mb-2">Something went wrong</h2>
              <p className="text-body mb-6">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <button
                className="bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}