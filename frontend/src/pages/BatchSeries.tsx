import { useState } from 'react';

import Navbar from '@/components/Navbar';
import { SeriesGenerator } from '@/components/SeriesGenerator';
import { UploadZone } from '@/components/UploadZone';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layers, Upload as UploadIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { safeToast } from '@/lib/safeToast';
import { useAuth } from '@/hooks/useAuth';

const BatchSeries = () => {
  const navigate = useNavigate();
  const { token } = useAuth();

  const [lastUploadedDocumentId, setLastUploadedDocumentId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('lastUploadedDocumentId');
    } catch {
      return null;
    }
  });

  const [lastUploadedDocumentTitle, setLastUploadedDocumentTitle] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('lastUploadedDocumentTitle');
    } catch {
      return null;
    }
  });

  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (file: File) => {
    if (!file) return;
    if (!token) {
      safeToast('Not authenticated');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name);
      formData.append('totalPrints', '5');

      const res = await api.post('/api/docs/upload', formData);
      const data = res.data;

      const uploadedIdRaw = (data as any)?.documentId ?? (data as any)?._id ?? (data as any)?.documentId?._id;
      const uploadedId = uploadedIdRaw ? String(uploadedIdRaw) : '';
      if (!uploadedId) {
        throw new Error('Upload failed: missing documentId');
      }

      const uploadedTitle = String((data as any)?.documentTitle || file.name || 'Uploaded Document');

      try {
        sessionStorage.setItem('lastUploadedDocumentId', uploadedId);
        sessionStorage.setItem('lastUploadedDocumentTitle', uploadedTitle);
      } catch {
        // ignore
      }

      setLastUploadedDocumentId(uploadedId);
      setLastUploadedDocumentTitle(uploadedTitle);
      toast.success('Document uploaded securely');
    } catch (err) {
      const e = err as any;
      const message = String(e?.response?.data?.message || '') || String(e?.message || '') || 'Upload failed';
      safeToast(message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container py-8">
        <h1 className="text-2xl font-semibold mb-8">Batch Series</h1>

        <Tabs
          defaultValue="batch"
          onValueChange={(v) => {
            if (v === 'upload') navigate('/upload');
          }}
          className="animate-fade-in"
          style={{ animationDelay: '0.1s' }}
        >
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger
              value="upload"
              className="gap-2"
              onClick={() => {
                navigate('/upload');
              }}
            >
              <UploadIcon className="h-4 w-4" />
              Secure Upload
            </TabsTrigger>
            <TabsTrigger value="batch" className="gap-2">
              <Layers className="h-4 w-4" />
              Batch Series
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-6">
          <UploadZone onFileSelect={handleFileSelect} isUploading={isUploading} />

          <SeriesGenerator
            sourceDocumentId={lastUploadedDocumentId}
            sourceDocumentTitle={lastUploadedDocumentTitle}
          />
        </div>
      </div>
    </div>
  );
};

export default BatchSeries;
