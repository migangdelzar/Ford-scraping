import {describe, expect, it} from 'vitest';
import {classifyPage} from '../../src/crawl/page-classifier.js';

describe('classifyPage', () => {
  it.each([
    ['/Todos/', 'Todos los modelos', 'catalog'],
    [
      '/TERRITORY/26/Ficha-Tecnica/',
      'Territory ficha técnica',
      'technical_sheet',
    ],
    ['/promociones/', 'Promociones Ford', 'promotion'],
    ['/Financiamiento/', 'Financiamiento', 'financing'],
    ['/Servicio/', 'Servicio Ford', 'service'],
    ['/Seminuevos/', 'Autos seminuevos', 'used_vehicle'],
    ['/Preguntas-Frecuentes/', 'Preguntas frecuentes', 'faq'],
    ['/Contacto/', 'Ford Uruapan', 'dealer_information'],
    ['/TERRITORY/26/', 'Ford Territory 2026', 'model'],
  ])('classifies %s as %s', (path, title, expected) => {
    expect(
      classifyPage(new URL(`https://www.forduruapan.mx${path}`), title, title),
    ).toBe(expected);
  });

  it('does not classify a year-suffixed privacy notice as a vehicle model', () => {
    expect(
      classifyPage(
        new URL('https://www.forduruapan.mx/Aviso-de-Privacidad/2026/'),
        'Aviso de Privacidad Ford 2026',
        'Aviso de privacidad integral Ford',
      ),
    ).toBe('unknown');
  });

  it('classifies a model page as model when its content mentions financing', () => {
    expect(
      classifyPage(
        new URL('https://www.forduruapan.mx/TERRITORY/26/'),
        'TERRITORY 2026 | Ford Uruapan',
        'Territory 2026. Solicita financiamiento y conoce nuestras opciones.',
      ),
    ).toBe('model');
  });
});
