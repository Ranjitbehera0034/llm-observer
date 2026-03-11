import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallbackText?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center text-red-500 bg-red-50 border border-red-200 rounded-lg m-4 dark:bg-red-900/20 dark:border-red-900/50">
          <h2 className="text-lg font-semibold mb-2">Something went wrong.</h2>
          <p className="text-sm opacity-80">{this.props.fallbackText || 'This section of the dashboard crashed. We have logged the error.'}</p>
          {this.state.error && (
            <pre className="text-xs text-left mt-4 p-2 bg-red-100 dark:bg-red-950 overflow-auto rounded max-h-40">
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
