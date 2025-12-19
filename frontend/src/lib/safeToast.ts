import { toast } from 'sonner';

export const safeToast = (msg: unknown, fallback = 'Something went wrong') => {
  try {
    toast(String(msg ?? fallback));
  } catch {
  }
};
