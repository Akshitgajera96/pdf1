import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A4 dimensions in points (72 dpi)
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const BLEED = 8.5; // 3mm in points
const MARGIN = 28; // ~10mm margin

// 2x2 grid positioning
const CARD_WIDTH = (A4_WIDTH - 2 * MARGIN - BLEED * 2) / 2;
const CARD_HEIGHT = (A4_HEIGHT - 2 * MARGIN - BLEED * 2) / 2;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { templateBase64, templateType, startNumber, endNumber, userId } = await req.json();

    console.log(`Generating series from ${startNumber} to ${endNumber} for user ${userId}`);

    if (!templateBase64) {
      throw new Error('Template is required');
    }

    const totalNumbers = endNumber - startNumber + 1;
    const sheetsNeeded = Math.ceil(totalNumbers / 4);

    console.log(`Total numbers: ${totalNumbers}, Sheets needed: ${sheetsNeeded}`);

    // Generate a simple PDF with numbered cards
    // This creates a valid PDF with the series numbers in a 2x2 grid layout
    const pdfContent = generateSeriesPdf(startNumber, endNumber, templateType);
    
    // Convert to base64
    const pdfBase64 = btoa(pdfContent);

    console.log('PDF generation complete');

    return new Response(
      JSON.stringify({ 
        pdfBase64,
        totalSheets: sheetsNeeded,
        totalNumbers
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error generating series PDF:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Generation failed' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function generateSeriesPdf(startNumber: number, endNumber: number, templateType: string): string {
  const totalNumbers = endNumber - startNumber + 1;
  const sheetsNeeded = Math.ceil(totalNumbers / 4);
  
  // PDF header
  let pdf = '%PDF-1.4\n';
  
  // Object counter
  let objNum = 1;
  const objects: { num: number; offset: number }[] = [];
  let content = '';
  
  // Catalog
  const catalogNum = objNum++;
  const catalogOffset = pdf.length + content.length;
  content += `${catalogNum} 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects.push({ num: catalogNum, offset: catalogOffset });
  
  // Pages
  const pagesNum = objNum++;
  const pageRefs = [];
  for (let i = 0; i < sheetsNeeded; i++) {
    pageRefs.push(`${objNum + i * 2} 0 R`);
  }
  const pagesOffset = pdf.length + content.length;
  content += `${pagesNum} 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${sheetsNeeded} >>\nendobj\n`;
  objects.push({ num: pagesNum, offset: pagesOffset });
  
  // Font
  const fontNum = objNum++;
  const fontOffset = pdf.length + content.length;
  content += `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;
  objects.push({ num: fontNum, offset: fontOffset });
  objNum = fontNum + 1;
  
  // Generate pages
  for (let sheet = 0; sheet < sheetsNeeded; sheet++) {
    // Page object
    const pageNum = objNum++;
    const pageOffset = pdf.length + content.length;
    const contentRef = objNum;
    content += `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Contents ${contentRef} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`;
    objects.push({ num: pageNum, offset: pageOffset });
    
    // Content stream
    const contentNum = objNum++;
    let streamContent = '';
    
    // Draw grid and numbers
    for (let pos = 0; pos < 4; pos++) {
      const numberIndex = sheet * 4 + pos;
      if (numberIndex >= totalNumbers) break;
      
      const number = startNumber + numberIndex;
      const col = pos % 2;
      const row = Math.floor(pos / 2);
      
      const x = MARGIN + BLEED + col * CARD_WIDTH;
      const y = A4_HEIGHT - MARGIN - BLEED - (row + 1) * CARD_HEIGHT;
      
      // Draw card background
      streamContent += `q\n`;
      streamContent += `0.95 0.95 0.95 rg\n`;
      streamContent += `${x + 5} ${y + 5} ${CARD_WIDTH - 10} ${CARD_HEIGHT - 10} re\nf\n`;
      
      // Draw border
      streamContent += `0.2 0.2 0.2 RG\n`;
      streamContent += `0.5 w\n`;
      streamContent += `${x + 5} ${y + 5} ${CARD_WIDTH - 10} ${CARD_HEIGHT - 10} re\nS\n`;
      
      // Draw number centered
      const numStr = number.toString().padStart(4, '0');
      streamContent += `BT\n`;
      streamContent += `/F1 48 Tf\n`;
      streamContent += `0 0 0 rg\n`;
      const textX = x + CARD_WIDTH / 2 - 48;
      const textY = y + CARD_HEIGHT / 2 - 12;
      streamContent += `${textX} ${textY} Td\n`;
      streamContent += `(${numStr}) Tj\n`;
      streamContent += `ET\n`;
      
      // Draw "SERIES" label
      streamContent += `BT\n`;
      streamContent += `/F1 12 Tf\n`;
      streamContent += `0.4 0.4 0.4 rg\n`;
      streamContent += `${x + CARD_WIDTH / 2 - 20} ${textY + 40} Td\n`;
      streamContent += `(SERIES) Tj\n`;
      streamContent += `ET\n`;
      
      streamContent += `Q\n`;
    }
    
    const contentOffset = pdf.length + content.length;
    content += `${contentNum} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`;
    objects.push({ num: contentNum, offset: contentOffset });
  }
  
  pdf += content;
  
  // Cross-reference table
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (const obj of objects) {
    pdf += obj.offset.toString().padStart(10, '0') + ' 00000 n \n';
  }
  
  // Trailer
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;
  
  return pdf;
}
