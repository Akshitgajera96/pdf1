import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    if (!session_token) {
      console.error('Missing session_token');
      return new Response(
        JSON.stringify({ error: 'Session token required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for admin access
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate session and get document access
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

    const document = access.documents;
    if (!document) {
      console.error('Document not found');
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch PDF from private storage
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

    // Return the PDF with secure headers
    const pdfBuffer = await fileData.arrayBuffer();
    
    return new Response(pdfBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Download-Options': 'noopen',
        'X-Content-Type-Options': 'nosniff',
      }
    });

  } catch (error) {
    console.error('Error in secure-render:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
