import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore: pdf-lib is loaded from a remote Deno-compatible URL
import { PDFDocument, rgb, degrees } from "https://esm.sh/pdf-lib@1.17.1?dts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_token } = await req.json();
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';

    if (!session_token) {
      console.error('Missing session_token');
      return new Response(
        JSON.stringify({ error: 'Session token required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate session and check print limit
    const { data: access, error: accessError } = await supabaseAdmin
      .from('document_access')
      .select(`
        *,
        documents (*)
      `)
      .eq('session_token', session_token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (accessError || !access) {
      console.error('Access error:', accessError || 'Session not found or expired');
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check print limit
    if (access.remaining_prints <= 0) {
      console.log('Print limit exceeded for session:', session_token);
      return new Response(
        JSON.stringify({ error: 'Print limit exceeded', remaining_prints: 0 }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const document = access.documents;
    if (!document) {
      console.error('Document not found');
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch original file (PDF or SVG) from private storage
    const { data: fileData, error: fileError } = await supabaseAdmin.storage
      .from('documents')
      .download(document.storage_path);

    if (fileError || !fileData) {
      console.error('File download error:', fileError);
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve document' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrement print count BEFORE returning PDF
    const newRemainingPrints = access.remaining_prints - 1;
    const { error: updateError } = await supabaseAdmin
      .from('document_access')
      .update({ remaining_prints: newRemainingPrints })
      .eq('id', access.id);

    if (updateError) {
      console.error('Failed to update print count:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to process print request' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the print
    const { error: logError } = await supabaseAdmin
      .from('print_logs')
      .insert({
        document_id: document.id,
        user_id: access.user_id,
        session_token: session_token,
        ip_address: ipAddress,
        user_agent: userAgent
      });

    if (logError) {
      console.error('Failed to log print:', logError);
      // Don't fail the request, just log the error
    }

    console.log(`Print authorized. Remaining prints: ${newRemainingPrints}`);

    // Determine if the original document is SVG based on storage path
    const storagePathLower = document.storage_path.toLowerCase();
    const isSvg = storagePathLower.endsWith('.svg');

    let originalPdfBuffer: ArrayBuffer;

    if (isSvg) {
      // Convert SVG to vector PDF using external svg-to-pdf service that expects
      // multipart/form-data with a "file" field containing the SVG content.
      const svgToPdfUrl = Deno.env.get('SVG_TO_PDF_URL') ??
        'https://srveddfqmiwqetltbpln.supabase.co/functions/v1/svg-to-pdf';

      const svgText = await fileData.text();

      // Build multipart/form-data payload with the SVG as a file.
      const formData = new FormData();
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
      formData.append('file', svgBlob, 'input.svg');

      const svgResponse = await fetch(svgToPdfUrl, {
        method: 'POST',
        body: formData,
      });

      if (!svgResponse.ok) {
        console.error('SVG to PDF conversion failed with status', svgResponse.status);
        return new Response(
          JSON.stringify({ error: 'Failed to convert SVG document for printing' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      originalPdfBuffer = await svgResponse.arrayBuffer();
    } else {
      // Original is already a PDF
      originalPdfBuffer = await fileData.arrayBuffer();
    }

    // Optionally enhance the PDF quality using an external CNN-based service before watermarking.
    // If PDF_ENHANCE_URL is not set or the call fails, we silently fall back to the original PDF bytes.
    try {
      const enhanceUrl = Deno.env.get('PDF_ENHANCE_URL');
      const enhanceApiKey = Deno.env.get('PDF_ENHANCE_API_KEY');
      const enhanceAuthHeaderName = Deno.env.get('PDF_ENHANCE_AUTH_HEADER_NAME') || 'Authorization';

      if (enhanceUrl) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/pdf',
        };

        // Allow flexible auth header configuration via env variables.
        // Examples:
        // - Authorization: Bearer <token>
        // - x-api-key: <key>
        if (enhanceApiKey) {
          headers[enhanceAuthHeaderName] = enhanceApiKey;
        }

        const enhanceResponse = await fetch(enhanceUrl, {
          method: 'POST',
          headers,
          body: originalPdfBuffer,
        });

        if (enhanceResponse.ok) {
          const enhancedBuffer = await enhanceResponse.arrayBuffer();
          if (enhancedBuffer && enhancedBuffer.byteLength > 0) {
            originalPdfBuffer = enhancedBuffer;
          }
        } else {
          console.error('PDF enhancement service returned status', enhanceResponse.status);
        }
      }
    } catch (enhanceError) {
      console.error('PDF enhancement step failed:', enhanceError);
    }

    // Load the (possibly converted and enhanced) PDF and add vector watermarks before returning
    const pdfDoc = await PDFDocument.load(originalPdfBuffer);

    // Build watermark text: use stored watermark_text if present, otherwise fall back
    const baseWatermarkText = access.watermark_text || 'Licensed Print';
    const watermarkText = `${baseWatermarkText} - ${new Date().toISOString()} - ID: ${session_token}`;

    const pages = pdfDoc.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();

      // Diagonal watermark across the page (vector text)
      page.drawText(watermarkText, {
        x: width * 0.15,
        y: height * 0.5,
        size: 18,
        rotate: degrees(-30),
        opacity: 0.25,
        color: rgb(0.5, 0.5, 0.5),
      });

      // Footer line for tracking
      page.drawText(`Secure Print | Session: ${session_token} | Remaining: ${newRemainingPrints}`, {
        x: width * 0.1,
        y: 24,
        size: 10,
        opacity: 0.7,
        color: rgb(0.4, 0.4, 0.4),
      });
    }

    const watermarkedPdfBytes = await pdfDoc.save();

    // Return the watermarked PDF with secure headers and remaining prints info
    return new Response(watermarkedPdfBytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Download-Options': 'noopen',
        'X-Content-Type-Options': 'nosniff',
        'X-Remaining-Prints': newRemainingPrints.toString(),
      }
    });

  } catch (error) {
    console.error('Error in secure-print:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
