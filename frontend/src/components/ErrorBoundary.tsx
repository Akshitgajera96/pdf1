import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);
    
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // UI-FIRST DEFENSE: Safe fallback UI that prevents white screen
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
            <p className="text-muted-foreground">
              We encountered an unexpected error. Please restart the app to continue.
            </p>
            
            <div className="space-y-3">
              <Button onClick={this.handleReload} className="w-full gap-2">
                <RefreshCw className="w-4 h-4" />
                Restart App
              </Button>
              
              {process.env.NODE_ENV === 'development' && (
                <details className="text-left bg-muted/50 rounded-lg p-4 text-sm">
                  <summary className="cursor-pointer font-medium">Error Details (Dev Only)</summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <strong>Error:</strong>
                      <pre className="mt-1 text-xs bg-background rounded p-2 overflow-auto">
                        {this.state.error?.toString()}
                      </pre>
                    </div>
                    <div>
                      <strong>Stack:</strong>
                      <pre className="mt-1 text-xs bg-background rounded p-2 overflow-auto max-h-32">
                        {this.state.error?.stack}
                      </pre>
                    </div>
                  </div>
                </details>
              )}
            </div>
            
            <div className="text-xs text-muted-foreground">
              If this problem persists, please contact support.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
