import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePhones, telUrl } from './phone.ts';

const dials = (raw: string, max?: number) => parsePhones(raw, max).map((p) => p.dial);

test('one number: digits and a leading +, label as written', () => {
  assert.deepEqual(parsePhones('+34 975 950 450'), [{ label: '+34 975 950 450', dial: '+34975950450' }]);
  assert.deepEqual(dials('975-950-450'), ['975950450']);
  assert.deepEqual(dials('975.95.04.50'), ['975950450']);
  assert.deepEqual(dials('(+34) 975 950 450'), ['+34975950450']);
  assert.deepEqual(dials('0034 975 950 450'), ['0034975950450']);
  assert.deepEqual(dials('Tel: 975 950 450'), ['975950450'], 'a word before the number');
  assert.deepEqual(parsePhones('112'), [{ label: '112', dial: '112' }]);
});

test('several numbers: OSM lists, commas, slashes between full numbers, a new +', () => {
  assert.deepEqual(dials('+34 975 950 450;+34 975 950 451'), ['+34975950450', '+34975950451']);
  assert.deepEqual(dials('+34 975 950 450; +34 975 950 451'), ['+34975950450', '+34975950451']);
  assert.deepEqual(dials('600 111 222, 600 333 444'), ['600111222', '600333444']);
  assert.deepEqual(dials('600 111 222 / 600 333 444'), ['600111222', '600333444']);
  assert.deepEqual(dials('+34 975 950 450 +34 975 950 451'), ['+34975950450', '+34975950451']);
  assert.deepEqual(dials('+34975950450+34975950451'), ['+34975950450', '+34975950451']);
  assert.deepEqual(dials('+34 975 950 450|112'), ['+34975950450', '112']);
});

test('a slash after the area code is one number', () => {
  assert.deepEqual(dials('030/1234567'), ['0301234567']);
  assert.deepEqual(dials('+43 1 / 234 56 78'), ['+4312345678']);
});

test('extensions and notes are not dialled; the extension stays in the label', () => {
  assert.deepEqual(parsePhones('+34 900 123 456 ext. 12'), [{ label: '+34 900 123 456 ext. 12', dial: '+34900123456' }]);
  assert.deepEqual(parsePhones('+1 555-123-4567 x89'), [{ label: '+1 555-123-4567 ext. 89', dial: '+15551234567' }]);
  assert.deepEqual(parsePhones('+1 555 123 4567 #4'), [{ label: '+1 555 123 4567 ext. 4', dial: '+15551234567' }]);
  assert.deepEqual(parsePhones('+34 975 950 450 (urgencias)'), [{ label: '+34 975 950 450', dial: '+34975950450' }]);
});

test('the (0) trunk prefix after a country code is dropped', () => {
  assert.deepEqual(dials('+44 (0)20 7946 0018'), ['+442079460018']);
  assert.deepEqual(dials('+49 (0) 30 123456'), ['+4930123456']);
  assert.deepEqual(dials('(030) 123456'), ['030123456'], 'a national area code in brackets stays');
});

test('nothing dialable, duplicates and the limit', () => {
  assert.deepEqual(parsePhones(''), []);
  assert.deepEqual(parsePhones(null), []);
  assert.deepEqual(parsePhones('pregunte en recepción'), []);
  assert.deepEqual(parsePhones('12'), [], 'too short');
  assert.deepEqual(parsePhones('123456789012345678'), [], 'too long');
  assert.deepEqual(dials('975 950 450;975950450'), ['975950450']);
  assert.deepEqual(dials('111 111 111;222 222 222;333 333 333;444 444 444'), ['111111111', '222222222', '333333333']);
  assert.deepEqual(dials('111 111 111;222 222 222', 1), ['111111111']);
});

test('telUrl', () => {
  assert.equal(telUrl(parsePhones('+34 975 950 450')[0]), 'tel:+34975950450');
  assert.equal(telUrl('112'), 'tel:112');
});
