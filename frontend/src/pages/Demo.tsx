import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const Demo = () => {
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Mini Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
        <Link 
          to="/" 
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Home</span>
        </Link>
        <div className="flex items-center gap-2">
          <div className="px-2 py-1 rounded bg-accent/20 text-accent text-xs font-medium">
            DEMO MODE
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg text-center space-y-2">
          <div className="text-lg font-semibold text-foreground">Demo page</div>
          <div className="text-sm text-muted-foreground">
            Document preview is not available in the web UI.
          </div>
        </div>
      </div>
    </div>
  );
};

export default Demo;
