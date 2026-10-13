import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import type {StoredPage} from '../../src/domain/contracts.js';
import {
  buildVehicleProfileContent,
  ingestPage,
} from '../../src/crawl/ingestion.js';

describe('vehicle profile semantic content', () => {
  it('adds query language only to semantic content when source facts support it', () => {
    const profile = buildVehicleProfileContent('BRONCO SPORT', 2026, [
      {name: 'Tracción', valueText: '4x4', category: 'technical'},
      {
        name: 'Selección G.O.A.T. Modes',
        valueText: 'Off-Road',
        category: 'technical',
      },
      {
        name: 'Profundidad de Vadeo',
        valueText: '450 mm',
        category: 'technical',
      },
      {name: 'Cajuela', valueText: '600 L', category: 'technical'},
      {name: 'Pasajeros', valueText: '5', category: 'technical'},
    ]);

    expect(profile.content).toContain('Tracción: 4x4');
    expect(profile.content).not.toContain('caminos difíciles');
    expect(profile.semanticContent).toContain('caminos difíciles');
    expect(profile.semanticContent).toContain('espacio para equipaje');
    expect(profile.semanticContent).toContain('viajes familiares');
    expect(profile.semanticContent).toContain('no se asignan a una versión');
  });

  it('does not add lifestyle search topics when supporting facts are absent', () => {
    const profile = buildVehicleProfileContent('TRANSIT', 2026, [
      {name: 'Motor', valueText: 'Eléctrico', category: 'technical'},
    ]);

    expect(profile.semanticContent).not.toContain('todoterreno');
    expect(profile.semanticContent).not.toContain('viajes familiares');
    expect(profile.semanticContent).not.toContain('eficiencia en ciudad');
  });
});

describe('model page ingestion', () => {
  it('does not replace stored details when a model page has no parsed details', async () => {
    const page: StoredPage = {
      id: 11,
      url: 'https://www.forduruapan.mx/RANGER/27/',
      canonicalUrl: 'https://www.forduruapan.mx/RANGER/27/',
      pageType: 'model',
      title: 'RANGER 2027 | Ford Uruapan',
      rawHtml: '<main><p>Details are rendered by JavaScript.</p></main>',
      extractedText: '',
      contentHash: 'empty-model-fixture',
      metadata: {},
    };
    const catalog = {
      upsertVehicle: vi
        .fn()
        .mockResolvedValue({modelId: 'model-1', modelYearId: 'year-1'}),
      upsertImages: vi.fn().mockResolvedValue(undefined),
      upsertVariants: vi.fn().mockResolvedValue(undefined),
      upsertSpecifications: vi.fn().mockResolvedValue(undefined),
      upsertFeatures: vi.fn().mockResolvedValue(undefined),
    };
    const documents = {
      upsertDocuments: vi.fn().mockResolvedValue(undefined),
      pruneDocumentChunks: vi.fn().mockResolvedValue(undefined),
    };

    await ingestPage(page, catalog as never, documents as never);

    expect(catalog.upsertSpecifications).not.toHaveBeenCalled();
    expect(catalog.upsertFeatures).not.toHaveBeenCalled();
  });

  it('persists parsed features with their source page', async () => {
    const page: StoredPage = {
      id: 12,
      url: 'https://www.forduruapan.mx/TERRITORY/26/',
      canonicalUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
      pageType: 'model',
      title: 'Ford Territory 2026',
      rawHtml: readFileSync('fixtures/pages/model.html', 'utf8'),
      extractedText: '',
      contentHash: 'model-fixture',
      metadata: {},
    };
    const ref = {modelId: 'model-1', modelYearId: 'year-1'};
    const catalog = {
      upsertVehicle: vi.fn().mockResolvedValue(ref),
      upsertImages: vi.fn().mockResolvedValue(undefined),
      upsertVariants: vi.fn().mockResolvedValue(undefined),
      upsertSpecifications: vi.fn().mockResolvedValue(undefined),
      upsertFeatures: vi.fn().mockResolvedValue(undefined),
    };
    const documents = {upsertDocuments: vi.fn().mockResolvedValue(undefined)};

    await ingestPage(page, catalog as never, documents as never);

    expect(catalog.upsertFeatures).toHaveBeenCalledWith(
      ref,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Cuenta con pantalla y conectividad.',
          category: 'tecnología',
        }),
      ]),
      page,
    );
  });

  it('persists present equipment from technical sheets as sourced features', async () => {
    const page: StoredPage = {
      id: 13,
      url: 'https://www.forduruapan.mx/TERRITORY/26/Ficha-Tecnica/',
      canonicalUrl: 'https://www.forduruapan.mx/TERRITORY/26/Ficha-Tecnica/',
      pageType: 'technical_sheet',
      title: 'Ficha técnica Territory 2026',
      rawHtml: `<div class="datos-ficha"><div class="seccion">
        <div class="seccion-item">Control Crucero</div>
        <div class="seccion-item">Adaptativo</div>
      </div></div>`,
      extractedText: '',
      contentHash: 'technical-fixture',
      metadata: {},
    };
    const ref = {modelId: 'model-1', modelYearId: 'year-1'};
    const catalog = {
      upsertVehicle: vi.fn().mockResolvedValue(ref),
      upsertSpecifications: vi.fn().mockResolvedValue(undefined),
      upsertFeatures: vi.fn().mockResolvedValue(undefined),
    };
    const documents = {
      upsertDocuments: vi.fn().mockResolvedValue(undefined),
      pruneDocumentChunks: vi.fn().mockResolvedValue(undefined),
    };

    await ingestPage(page, catalog as never, documents as never);

    expect(catalog.upsertFeatures).toHaveBeenCalledWith(
      ref,
      [
        {
          name: 'Control Crucero',
          description: 'Adaptativo',
          category: 'equipment',
        },
      ],
      page,
    );
  });

  it('does not replace stored details when a technical sheet has no parsed specs', async () => {
    const page: StoredPage = {
      id: 14,
      url: 'https://www.forduruapan.mx/RANGER/27/Ficha-Tecnica/',
      canonicalUrl: 'https://www.forduruapan.mx/RANGER/27/Ficha-Tecnica/',
      pageType: 'technical_sheet',
      title: 'Ficha técnica RANGER 2027',
      rawHtml: '<main><div id="app"></div></main>',
      extractedText: '',
      contentHash: 'empty-technical-fixture',
      metadata: {},
    };
    const catalog = {
      upsertVehicle: vi
        .fn()
        .mockResolvedValue({modelId: 'model-1', modelYearId: 'year-1'}),
      upsertSpecifications: vi.fn().mockResolvedValue(undefined),
      upsertFeatures: vi.fn().mockResolvedValue(undefined),
    };
    const documents = {upsertDocuments: vi.fn().mockResolvedValue(undefined)};

    await ingestPage(page, catalog as never, documents as never);

    expect(catalog.upsertSpecifications).not.toHaveBeenCalled();
    expect(catalog.upsertFeatures).not.toHaveBeenCalled();
  });
});
