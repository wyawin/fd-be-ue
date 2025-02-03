import { DocumentAnalyzer } from '../services/DocumentAnalyzer.js';
import fs from 'fs/promises';
import path from 'path';

describe('DocumentAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new DocumentAnalyzer();
  });

  test('should detect font family inconsistencies', async () => {
    const mockMetrics = [
      { fontFamily: 'Arial', fontSize: 12, text: 'Test', position: { x: 0, y: 0 }, width: 10, height: 10 },
      { fontFamily: 'Times', fontSize: 12, text: 'Test', position: { x: 20, y: 0 }, width: 10, height: 10 },
      { fontFamily: 'Helvetica', fontSize: 12, text: 'Test', position: { x: 40, y: 0 }, width: 10, height: 10 }
    ];

    const inconsistencies = await analyzer.analyzeFontFamilyConsistency(mockMetrics);
    expect(inconsistencies.length).toBeGreaterThan(0);
  });

  test('should detect font size inconsistencies', async () => {
    const mockMetrics = [
      { fontFamily: 'Arial', fontSize: 12, text: 'Test', position: { x: 0, y: 0 }, width: 10, height: 10 },
      { fontFamily: 'Arial', fontSize: 12.5, text: 'Test', position: { x: 20, y: 0 }, width: 10, height: 10 },
      { fontFamily: 'Arial', fontSize: 13, text: 'Test', position: { x: 40, y: 0 }, width: 10, height: 10 }
    ];

    const inconsistencies = await analyzer.analyzeFontSizeConsistency(mockMetrics);
    expect(inconsistencies.length).toBeGreaterThan(0);
  });

  test('should detect spacing inconsistencies', async () => {
    const mockMetrics = [
      { fontFamily: 'Arial', fontSize: 12, text: 'Test', position: { x: 0, y: 0 }, width: 10, height: 10 },
      { fontFamily: 'Arial', fontSize: 12, text: 'Test', position: { x: 50, y: 0 }, width: 10, height: 10 }, // Large gap
      { fontFamily: 'Arial', fontSize: 12, text: 'Test', position: { x: 60, y: 0 }, width: 10, height: 10 }
    ];

    const inconsistencies = await analyzer.analyzeSpacingConsistency(mockMetrics);
    expect(inconsistencies.length).toBeGreaterThan(0);
  });

  test('should generate comprehensive report', async () => {
    const mockInconsistencies = {
      fontFamily: [{ type: 'fontFamily', severity: 'high', description: 'Test' }],
      fontSize: [{ type: 'fontSize', severity: 'medium', description: 'Test' }],
      spacing: [{ type: 'spacing', severity: 'low', description: 'Test' }]
    };

    const report = analyzer.generateReport(mockInconsistencies);
    
    expect(report).toHaveProperty('suspicious');
    expect(report).toHaveProperty('severityScore');
    expect(report).toHaveProperty('confidence');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('details');
  });
});