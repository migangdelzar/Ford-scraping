import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import type {PageType, StoredPage} from '../../src/domain/contracts.js';
import {parseCatalogPage} from '../../src/parsers/catalog-parser.js';
import {parseModelPage} from '../../src/parsers/model-parser.js';
import {parsePublicInformationPage} from '../../src/parsers/public-page-parser.js';
import {parseTechnicalSheet} from '../../src/parsers/technical-sheet-parser.js';
import {parseUsedVehiclePage} from '../../src/parsers/used-vehicle-parser.js';
import {createParserRegistry} from '../../src/parsers/registry.js';

function readPage(file: string, pageType: PageType): StoredPage {
  const rawHtml = readFileSync(`fixtures/pages/${file}`, 'utf8');
  return {
    url: `https://www.forduruapan.mx/${file}`,
    canonicalUrl: `https://www.forduruapan.mx/${file}`,
    pageType,
    title: 'Fixture',
    rawHtml,
    extractedText: rawHtml,
    contentHash: 'fixture',
    metadata: {},
  };
}

describe('page parsers', () => {
  it('extracts catalog price and preserves the card link', () => {
    const result = parseCatalogPage(readPage('catalog.html', 'catalog'));
    expect(result.value[0]).toMatchObject({
      modelName: 'Territory',
      modelYear: 2026,
      startingPrice: 559900,
      sourceUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
    });
  });

  it('extracts live catalog anchor cards grouped by category tabs', () => {
    const result = parseCatalogPage({
      ...readPage('catalog.html', 'catalog'),
      rawHtml: `<div class="tab-pane" id="SUVs & Crossovers">
        <div class="autos-content-web">
          <a class="autos-item-web" href="/TERRITORY/26/">
            <p>Territory<span> 2026</span></p>
            <small><span>Desde</span><span class="precio">$559,900</span><span>MXN</span></small>
          </a>
        </div>
      </div>`,
    });

    expect(result.value).toEqual([
      expect.objectContaining({
        modelName: 'Territory',
        modelYear: 2026,
        startingPrice: 559900,
        category: 'SUVs & Crossovers',
        sourceUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
      }),
    ]);
  });

  it('falls back to the SSR hidden vehicle payload when cards are rendered by JavaScript', () => {
    const result = parseCatalogPage({
      ...readPage('catalog.html', 'catalog'),
      rawHtml:
        '<input id="hAutos" value=\'[{"modelo":"TERRITORY","anio":"26","Precio":"559900","TipCarr":"2","claveGen":"TORY26"}]\'>',
    });

    expect(result.value).toEqual([
      expect.objectContaining({
        modelName: 'TERRITORY',
        modelYear: 2026,
        startingPrice: 559900,
        category: 'SUVs & Crossovers',
        sourceUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
      }),
    ]);
  });

  it('extracts model sections, image alt text, and technical-sheet links', () => {
    const result = parseModelPage({
      ...readPage('model.html', 'model'),
      url: 'https://www.forduruapan.mx/TERRITORY/26/',
    });
    expect(result.value).toMatchObject({
      modelName: 'Territory',
      modelYear: 2026,
    });
    expect(result.value.sections).toMatchObject({
      tecnología: 'Cuenta con pantalla y conectividad.',
      seguridad: 'Incluye asistencia al conductor.',
    });
    expect(result.value.images[0]).toEqual({
      url: 'https://www.forduruapan.mx/Assets/ModelosNuevos/Img/Modelos/Territory.webp',
      altText: 'Ford Territory blanca',
      width: undefined,
      height: undefined,
      imageType: 'model',
    });
  });

  it('removes the dealer suffix when the model title comes from the page title', () => {
    const result = parseModelPage({
      ...readPage('model.html', 'model'),
      title: 'TERRITORY 2026 | Ford Uruapan',
      rawHtml: '<main><p>Territory description.</p></main>',
      url: 'https://www.forduruapan.mx/TERRITORY/26/',
    });

    expect(result.value.modelName).toBe('Territory');
  });

  it('reads the abbreviated model year from the Ford model URL', () => {
    const result = parseModelPage({
      ...readPage('model.html', 'model'),
      title: 'RANGER RAPTOR | Ford Uruapan',
      rawHtml: '<main><p>Ranger Raptor description.</p></main>',
      url: 'https://www.forduruapan.mx/RANGER-RAPTOR/27/',
    });

    expect(result.value.modelYear).toBe(2027);
  });

  it('extracts table and definition-list technical specifications', () => {
    const result = parseTechnicalSheet({
      ...readPage('technical-sheet.html', 'technical_sheet'),
      url: 'https://www.forduruapan.mx/TERRITORY/26/Ficha-Tecnica/',
    });
    expect(result.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: 'power_hp',
          valueNumeric: 190,
        }),
        expect.objectContaining({
          normalizedName: 'torque_nm',
          valueNumeric: 320,
        }),
        expect.objectContaining({
          normalizedName: 'seating_capacity',
          valueNumeric: 5,
        }),
        expect.objectContaining({
          normalizedName: 'transmission',
          valueText: 'Automática',
        }),
      ]),
    );
  });

  it('extracts Ford technical-sheet sections from the live ficha layout', () => {
    const result = parseTechnicalSheet({
      ...readPage('technical-sheet.html', 'technical_sheet'),
      rawHtml: `<div class="datos-ficha">
        <div class="seccion">
          <div class="seccion-item"><p>Transmisión</p></div>
          <div class="seccion-item"><p>7 velocidades</p></div>
        </div>
      </div>`,
    });

    expect(result.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedName: 'transmission',
          valueText: '7 velocidades',
        }),
      ]),
    );
  });

  it('parses Spanish thousands correctly and only assigns units beside numbers', () => {
    const result = parseTechnicalSheet({
      ...readPage('technical-sheet.html', 'technical_sheet'),
      rawHtml: `<table>
        <tr><td>Espacio para hombros (mm)</td><td>1,494 / 1,484</td></tr>
        <tr><td>Pantalla Táctil</td><td>12 pulgadas con Apple CarPlay</td></tr>
      </table>`,
    });

    expect(result.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Espacio para hombros (mm)',
          valueNumeric: 1494,
          unit: 'mm',
        }),
        expect.objectContaining({
          name: 'Pantalla Táctil',
          valueNumeric: 12,
          unit: undefined,
        }),
      ]),
    );
  });

  it('labels features extracted from Ford ficha equipment rows', () => {
    const result = parseTechnicalSheet({
      ...readPage('technical-sheet.html', 'technical_sheet'),
      rawHtml: `<div class="datos-ficha"><div class="seccion">
        <div class="seccion-item">Control Crucero</div>
        <div class="seccion-item">Adaptativo</div>
      </div></div>`,
    });

    expect(result.value[0]).toMatchObject({
      name: 'Control Crucero',
      valueText: 'Adaptativo',
      category: 'equipment',
    });
  });

  it.each([
    ['promotion.html', 'promotion'],
    ['financing.html', 'financing'],
    ['service.html', 'service'],
    ['used-vehicle.html', 'used_vehicle'],
    ['faq.html', 'faq'],
    ['dealer-information.html', 'dealer_information'],
  ] as const)('retains public information for %s', (file, pageType) => {
    const result = parsePublicInformationPage(readPage(file, pageType));
    expect(result.value.documentType).toBe(pageType);
    expect(result.value.content).toMatch(
      /Ford|Territory|Servicio|Promociones|Preguntas|Conoce/,
    );
  });

  it('extracts explicit financing terms from an offer card', () => {
    const result = parsePublicInformationPage(
      readPage('promotion.html', 'promotion'),
    );
    expect(result.value.offers).toEqual([
      expect.objectContaining({
        title: 'Territory 12 meses sin intereses',
        modelName: 'Territory',
        modelYear: 2026,
        offerType: 'months_without_interest',
        provider: 'BBVA',
        monthsWithoutInterest: 12,
        cashPrice: 559900,
        validUntil: '2026-10-31',
      }),
    ]);
  });

  it('extracts structured Seminuevos inventory from an SSR card', () => {
    const result = parseUsedVehiclePage(
      readPage('used-vehicle.html', 'used_vehicle'),
    );
    expect(result.value).toEqual([
      expect.objectContaining({
        inventoryId: '514854',
        title: 'Ford Territory Titanium',
        price: 530000,
        mileageKm: 30332,
        transmission: 'automatic',
        detailUrl:
          'https://www.forduruapan.mx/Seminuevos/FORD/TERRITORY/2023/514854',
        imageUrls: [
          'https://www.forduruapan.mx/SeminuevosMotorV3/images/territory.jpg',
        ],
      }),
    ]);
  });

  it('extracts structured terms from the live promotion-card shape', () => {
    const result = parsePublicInformationPage({
      ...readPage('promotion.html', 'promotion'),
      rawHtml: `<div class="promo-item" data-id="2261" data-tipopromo="Autos">
        <a href="/BRONCO-SPORT/26/"><img alt="Autos"></a>
        <h3>Bronco Sport</h3>
        <small>Vigencia del 1 de septiembre de 2026 al 30 de septiembre de 2026.</small>
        <div class="txt-promocion">
          <h4>Bronco Sport 2026</h4>
          <p>Sujeto a análisis de crédito por parte de Ford Credit.</p>
          <p>Bono de $100,000.00 (CIEN MIL PESOS 00/100 M.N.) para Ford Bronco Sport 2026.</p>
        </div>
      </div>`,
    });

    expect(result.value.offers).toEqual([
      expect.objectContaining({
        title: 'Bronco Sport 2026',
        offerType: 'promotion',
        modelName: 'Bronco Sport',
        modelYear: 2026,
        discountAmount: 100000,
        termMonths: undefined,
        validFrom: '2026-09-01',
        validUntil: '2026-09-30',
        sourceUrl: 'https://www.forduruapan.mx/promotion.html',
      }),
    ]);
    expect(result.value.offers[0].metadata).toMatchObject({
      extraction: 'live-promo-item',
      externalPromotionId: '2261',
      modelUrl: 'https://www.forduruapan.mx/BRONCO-SPORT/26/',
    });
  });

  it('orders specific parsers before the generic parser', () => {
    const registry = createParserRegistry();
    const parser = registry.find(candidate =>
      candidate.supports(readPage('catalog.html', 'catalog')),
    );
    expect(parser?.constructor.name).toContain('Catalog');
  });
});
