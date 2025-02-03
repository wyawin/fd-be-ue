import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import natural from 'natural';
import { logger } from '../utils/logger.js';

export class DocumentAnalyzer {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.baselineFontMetrics = new Map();
  }

  async analyzePDF(pdfBuffer) {
    try {
      const copyPdf = new Uint8Array(pdfBuffer); 
      const fontMetrics = await this.extractFontMetrics(pdfBuffer);
      
      const inconsistencies = {
        fontFamily: await this.analyzeFontFamilyConsistency(fontMetrics),
        fontSize: await this.analyzeFontSizeConsistency(fontMetrics),
        spacing: await this.analyzeSpacingConsistency(fontMetrics)
      };

      // Get unique font families
      const uniqueFontFamilies = [...new Set(fontMetrics.map(metric => metric.fontFamily))];

      // Add font families to the inconsistencies object
      inconsistencies.fontFamily = {
        issues: inconsistencies.fontFamily,
        detectedFonts: uniqueFontFamilies.map(font => ({
          name: font,
          occurrences: fontMetrics.filter(metric => metric.fontFamily === font).length
        }))
      };

      const report = this.generateReport(inconsistencies);
      
      // Generate both highlighted PDFs
      const highlightedPdf = await this.generateHighlightedPDF(copyPdf, fontMetrics, inconsistencies);
      const fontTypePdf = await this.generateFontTypePDF(copyPdf, fontMetrics);

      return {
        ...report,
        highlightedPdf: Buffer.from(highlightedPdf).toString('base64'),
        fontTypePdf: fontTypePdf
      };
    } catch (error) {
      logger.error('Error analyzing PDF:', error);
      throw new Error('Failed to analyze PDF document');
    }
  }

  async extractFontMetrics(pdfBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
    const pdfDocument = await loadingTask.promise;
    const fontMetrics = [];

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      for (const item of textContent.items) {
        fontMetrics.push({
          text: item.str,
          fontSize: item.transform[0], // Font size from transformation matrix
          fontFamily: item.fontName,
          position: {
            x: item.transform[4],
            y: item.transform[5]
          },
          width: item.width,
          height: item.height
        });
      }
    }

    return fontMetrics;
  }

  async analyzeFontFamilyConsistency(metrics) {
    const inconsistencies = [];
    const fontFamilyGroups = new Map();

    // Group text by context (e.g., paragraphs, headers)
    metrics.forEach(metric => {
      const context = this.determineContext(metric);
      if (!fontFamilyGroups.has(context)) {
        fontFamilyGroups.set(context, new Set());
      }
      fontFamilyGroups.get(context).add(metric.fontFamily);
    });

    // Analyze each context for inconsistencies
    for (const [context, fonts] of fontFamilyGroups) {
      if (fonts.size > 2) { // Allow for regular and bold/italic variants
        inconsistencies.push({
          type: 'fontFamily',
          context,
          description: `Multiple font families (${fonts.size}) detected in same context`,
          severity: 'high',
          detectedFonts: Array.from(fonts)
        });
      }
    }

    return inconsistencies;
  }

  async analyzeFontSizeConsistency(metrics) {
    const inconsistencies = [];
    const fontSizeGroups = new Map();

    // Group text by context
    metrics.forEach(metric => {
      const context = this.determineContext(metric);
      if (!fontSizeGroups.has(context)) {
        fontSizeGroups.set(context, []);
      }
      fontSizeGroups.get(context).push(metric.fontSize);
    });

    // Analyze each context for size inconsistencies
    for (const [context, sizes] of fontSizeGroups) {
      const mean = sizes.reduce((a, b) => a + b) / sizes.length;
      const variance = sizes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sizes.length;
      
      if (variance > 2) { // Threshold for suspicious variance
        inconsistencies.push({
          type: 'fontSize',
          context,
          description: `Suspicious font size variations detected`,
          severity: 'medium',
          details: { mean, variance }
        });
      }
    }

    return inconsistencies;
  }

  async analyzeSpacingConsistency(metrics) {
    const inconsistencies = [];
    let previousMetric = null;

    metrics.forEach(metric => {
      if (previousMetric) {
        const spacing = this.calculateSpacing(previousMetric, metric);
        const isAbnormal = this.isSpacingAbnormal(spacing);

        if (isAbnormal) {
          inconsistencies.push({
            type: 'spacing',
            position: metric.position,
            description: 'Abnormal character spacing detected',
            severity: 'medium',
            details: { spacing }
          });
        }
      }
      previousMetric = metric;
    });

    return inconsistencies;
  }

  determineContext(metric) {
    // Simple context determination based on font size
    if (metric.fontSize > 20) return 'header';
    if (metric.fontSize > 14) return 'subheader';
    return 'body';
  }

  calculateSpacing(prev, current) {
    return Math.sqrt(
      Math.pow(current.position.x - (prev.position.x + prev.width), 2) +
      Math.pow(current.position.y - prev.position.y, 2)
    );
  }

  isSpacingAbnormal(spacing) {
    // Define normal spacing ranges (can be adjusted based on document type)
    const MIN_NORMAL_SPACING = 0.1;
    const MAX_NORMAL_SPACING = 20;
    return spacing < MIN_NORMAL_SPACING || spacing > MAX_NORMAL_SPACING;
  }

  generateReport(inconsistencies) {
    const totalIssues = Object.values(inconsistencies)
      .reduce((sum, issues) => {
        if (Array.isArray(issues)) {
          return sum + issues.length;
        } else if (issues.issues) {
          return sum + issues.issues.length;
        }
        return sum;
      }, 0);

    const severityScore = this.calculateSeverityScore(inconsistencies);
    
    return {
      timestamp: new Date().toISOString(),
      suspicious: totalIssues > 0,
      severityScore,
      confidence: this.calculateConfidenceScore(totalIssues, severityScore),
      summary: {
        totalIssues,
        fontFamilyIssues: inconsistencies.fontFamily.issues.length,
        fontSizeIssues: inconsistencies.fontSize.length,
        spacingIssues: inconsistencies.spacing.length
      },
      details: {
        fontFamily: {
          issues: inconsistencies.fontFamily.issues,
          detectedFonts: inconsistencies.fontFamily.detectedFonts
        },
        fontSize: inconsistencies.fontSize,
        spacing: inconsistencies.spacing
      }
    };
  }

  calculateSeverityScore(inconsistencies) {
    const weights = {
      fontFamily: 0.4,
      fontSize: 0.3,
      spacing: 0.3
    };

    return Object.entries(inconsistencies).reduce((score, [type, issues]) => {
      const typeWeight = weights[type] || 0;
      const issuesList = Array.isArray(issues) ? issues : (issues.issues || []);
      const issueScore = issuesList.reduce((sum, issue) => {
        const severityMultiplier = issue.severity === 'high' ? 1 :
                                  issue.severity === 'medium' ? 0.6 : 0.3;
        return sum + severityMultiplier;
      }, 0);
      return score + (issueScore * typeWeight);
    }, 0);
  }

  calculateConfidenceScore(totalIssues, severityScore) {
    // Normalize confidence score between 0 and 1
    const baseConfidence = Math.min(1, Math.max(0, 1 - (severityScore / 10)));
    const issuesPenalty = Math.min(0.5, totalIssues * 0.1);
    return Math.max(0, baseConfidence - issuesPenalty);
  }

  async generateHighlightedPDF(originalPdfBuffer, metrics, inconsistencies) {
    try {
      const pdfDoc = await PDFDocument.load(originalPdfBuffer);
      const pages = pdfDoc.getPages();

      // Define highlight colors for different types of issues
      const colors = {
        fontFamily: rgb(1, 0, 0),    // Red
        fontSize: rgb(1, 0.5, 0),    // Orange
        spacing: rgb(1, 1, 0)        // Yellow
      };

      // Add highlights for font family issues
      if (inconsistencies.fontFamily && inconsistencies.fontFamily.issues) {
        for (const issue of inconsistencies.fontFamily.issues) {
          const affectedMetrics = metrics.filter(m => 
            issue.detectedFonts && issue.detectedFonts.includes(m.fontFamily) &&
            this.determineContext(m) === issue.context
          );

          for (const metric of affectedMetrics) {
            const pageIndex = Math.floor(metric.position.y / pages[0].getHeight());
            if (pageIndex >= 0 && pageIndex < pages.length) {
              const page = pages[pageIndex];
              page.drawRectangle({
                x: metric.position.x,
                y: page.getHeight() - metric.position.y,
                width: metric.width || 10,
                height: metric.height || 10,
                color: colors.fontFamily,
                opacity: 0.3
              });
            }
          }
        }
      }

      // Add highlights for font size issues
      if (inconsistencies.fontSize) {
        for (const issue of inconsistencies.fontSize) {
          const affectedMetrics = metrics.filter(m => 
            this.determineContext(m) === issue.context
          );

          for (const metric of affectedMetrics) {
            const pageIndex = Math.floor(metric.position.y / pages[0].getHeight());
            if (pageIndex >= 0 && pageIndex < pages.length) {
              const page = pages[pageIndex];
              page.drawRectangle({
                x: metric.position.x,
                y: page.getHeight() - metric.position.y,
                width: metric.width || 10,
                height: metric.height || 10,
                color: colors.fontSize,
                opacity: 0.3
              });
            }
          }
        }
      }

      // Add highlights for spacing issues
      if (inconsistencies.spacing) {
        for (const issue of inconsistencies.spacing) {
          if (issue.position) {
            const pageIndex = Math.floor(issue.position.y / pages[0].getHeight());
            if (pageIndex >= 0 && pageIndex < pages.length) {
              const page = pages[pageIndex];
              page.drawRectangle({
                x: issue.position.x,
                y: page.getHeight() - issue.position.y,
                width: 10,
                height: 10,
                color: colors.spacing,
                opacity: 0.3
              });
            }
          }
        }
      }

      // Add legend to the first page
      const firstPage = pages[0];
      const legendY = 50;
      const legendX = 50;

      firstPage.drawText('Suspicious Areas Legend:', {
        x: legendX,
        y: legendY + 60,
        size: 12
      });

      Object.entries(colors).forEach(([type, color], index) => {
        firstPage.drawRectangle({
          x: legendX,
          y: legendY + (index * 20),
          width: 15,
          height: 15,
          color: color,
          opacity: 0.3
        });

        firstPage.drawText(type.charAt(0).toUpperCase() + type.slice(1) + ' Issues', {
          x: legendX + 25,
          y: legendY + (index * 20) + 4,
          size: 10
        });
      });

      return await pdfDoc.save();
    } catch (error) {
      logger.error('Error generating highlighted PDF:', error);
      throw new Error('Failed to generate highlighted PDF');
    }
  }

  async generateFontTypePDF(originalPdfBuffer, metrics) {
    try {
      const pdfDoc = await PDFDocument.load(originalPdfBuffer);
      const pages = pdfDoc.getPages();

      // Create a color map for different font families
      const uniqueFonts = [...new Set(metrics.map(m => m.fontFamily))];
      const fontColors = {};
      
      // Generate distinct colors for each font family
      uniqueFonts.forEach((font, index) => {
        const hue = (index * 360 / uniqueFonts.length) / 360;
        fontColors[font] = {
          color: rgb(
            Math.sin(hue * Math.PI * 2) * 0.5 + 0.5,
            Math.sin((hue + 1/3) * Math.PI * 2) * 0.5 + 0.5,
            Math.sin((hue + 2/3) * Math.PI * 2) * 0.5 + 0.5
          ),
          count: metrics.filter(m => m.fontFamily === font).length
        };
      });

      // Highlight text based on font family
      for (const metric of metrics) {
        const pageIndex = Math.floor(metric.position.y / pages[0].getHeight());
        if (pageIndex >= 0 && pageIndex < pages.length) {
          const page = pages[pageIndex];
          const color = fontColors[metric.fontFamily].color;
          
          page.drawRectangle({
            x: metric.position.x,
            y: page.getHeight() - metric.position.y,
            width: metric.width || 10,
            height: metric.height || 10,
            color: color,
            opacity: 0.3
          });
        }
      }

      // Add legend to the first page
      const firstPage = pages[0];
      const legendY = 50;
      const legendX = 50;

      firstPage.drawText('Font Types Legend:', {
        x: legendX,
        y: legendY + (Object.keys(fontColors).length * 20) + 40,
        size: 12,
        color: rgb(0, 0, 0)
      });

      Object.entries(fontColors).forEach(([fontName, { color, count }], index) => {
        // Draw color rectangle
        firstPage.drawRectangle({
          x: legendX,
          y: legendY + (index * 20),
          width: 15,
          height: 15,
          color: color,
          opacity: 0.3
        });

        // Draw font name and count
        firstPage.drawText(`${fontName} (${count} occurrences)`, {
          x: legendX + 25,
          y: legendY + (index * 20) + 4,
          size: 10,
          color: rgb(0, 0, 0)
        });
      });

      return Buffer.from(await pdfDoc.save()).toString('base64');
    } catch (error) {
      logger.error('Error generating font type PDF:', error);
      throw new Error('Failed to generate font type PDF');
    }
  }
}