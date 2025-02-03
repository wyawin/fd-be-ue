import express from 'express';
import multer from 'multer';
import { DocumentAnalyzer } from './services/DocumentAnalyzer.js';
import { logger } from './utils/logger.js';

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
const analyzer = new DocumentAnalyzer();

app.post('/analyze', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    if (!req.file.mimetype.includes('pdf')) {
      return res.status(400).json({ error: 'File must be a PDF' });
    }

    const pdfData = new Uint8Array(req.file.buffer);
    const result = await analyzer.analyzePDF(pdfData);

    res.setHeader('Content-Type', 'application/json');
    res.json({
      analysis: {
        timestamp: result.timestamp,
        suspicious: result.suspicious,
        severityScore: result.severityScore,
        confidence: result.confidence,
        summary: result.summary,
        details: result.details
      },
      highlightedPdf: result.highlightedPdf, // PDF with suspicious areas highlighted
      fontTypePdf: result.fontTypePdf // PDF with different font types highlighted
    });
  } catch (error) {
    logger.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to analyze PDF' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});