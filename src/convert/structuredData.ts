import { parseHTML } from 'linkedom';
import type { StructuredDataItem, StructuredDataQuestion } from '../types.js';

const MAX_ITEMS = 8;
const MAX_IMAGES = 8;
const MAX_LIST_ITEMS = 40;

export function extractStructuredData(html: string, baseUrl: string): StructuredDataItem[] {
  const { document } = parseHTML(html);
  return extractStructuredDataFromDocument(document, baseUrl);
}

export function extractStructuredDataFromDocument(document: Document, baseUrl: string): StructuredDataItem[] {
  const items: StructuredDataItem[] = [];
  const seen = new Set<string>();

  for (const script of Array.from(document.querySelectorAll('script[type*="ld+json"]'))) {
    const text = script.textContent?.trim();
    if (!text) {
      continue;
    }

    for (const node of parseJsonLdNodes(text)) {
      const item = summarizeNode(node, baseUrl);
      if (!item) {
        continue;
      }

      const key = `${item.type}\u0000${item.name ?? ''}\u0000${item.url ?? ''}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      items.push({ ...item, index: items.length + 1 });

      if (items.length >= MAX_ITEMS) {
        return items;
      }
    }
  }

  return items;
}

export function appendStructuredData(markdown: string, items: StructuredDataItem[]): string {
  if (items.length === 0) {
    return markdown;
  }

  const lines = ['## Structured Data', ''];

  for (const item of items) {
    const title = [item.type, item.name].filter(Boolean).join(': ');
    lines.push(`### ${item.index}. ${title || item.type}`, '');

    appendField(lines, 'Description', item.description);
    appendField(lines, 'URL', item.url);
    appendField(lines, 'Author', item.authors?.join(', '));
    appendField(lines, 'Published', item.date_published);
    appendField(lines, 'Modified', item.date_modified);
    appendField(lines, 'Start', item.start_date);
    appendField(lines, 'End', item.end_date);
    appendField(lines, 'Previous start', item.previous_start_date);
    appendField(lines, 'Event status', item.event_status);
    appendField(lines, 'Attendance mode', item.attendance_mode);
    appendField(lines, 'Location', item.location);
    appendField(lines, 'Organizer', item.organizers?.join(', '));
    appendField(lines, 'Performer', item.performers?.join(', '));
    appendField(lines, 'Yield', item.recipe_yield);
    appendField(lines, 'Prep time', item.prep_time);
    appendField(lines, 'Cook time', item.cook_time);
    appendField(lines, 'Total time', item.total_time);
    appendField(lines, 'Category', item.recipe_category?.join(', '));
    appendField(lines, 'Cuisine', item.recipe_cuisine?.join(', '));
    appendField(lines, 'Rating', item.rating);

    appendList(lines, 'Images', item.images);
    appendList(lines, 'Offers', item.offers);
    appendList(lines, 'Ingredients', item.ingredients);
    appendList(lines, 'Instructions', item.instructions, true);
    appendQuestions(lines, item.questions);

    lines.push('');
  }

  return `${markdown.trimEnd()}\n\n${lines.join('\n').trimEnd()}\n`;
}

function parseJsonLdNodes(text: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(stripJsonLd(text));
    return flattenJsonLd(parsed);
  } catch {
    return [];
  }
}

function stripJsonLd(text: string): string {
  return text
    .replace(/^<!--/u, '')
    .replace(/-->$/u, '')
    .trim();
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (!isRecord(value)) {
    return [];
  }

  const graph = value['@graph'];
  if (Array.isArray(graph)) {
    return graph.flatMap(flattenJsonLd);
  }

  return [value];
}

function summarizeNode(node: Record<string, unknown>, baseUrl: string): Omit<StructuredDataItem, 'index'> | undefined {
  const type = typeName(node['@type']);
  if (!type) {
    return undefined;
  }

  const item: Omit<StructuredDataItem, 'index'> = {
    type,
  };

  const name = textValue(node.name) || textValue(node.headline);
  if (name) item.name = name;

  const description = textValue(node.description);
  if (description) item.description = description;

  const url = urlValue(node.url ?? node.mainEntityOfPage, baseUrl);
  if (url) item.url = url;

  const images = imageValues(node.image, baseUrl);
  if (images.length > 0) item.images = images;

  const authors = arrayValues(node.author).map(textValue).filter(Boolean);
  if (authors.length > 0) item.authors = authors;

  assignText(item, 'date_published', node.datePublished);
  assignText(item, 'date_modified', node.dateModified);
  assignText(item, 'start_date', node.startDate);
  assignText(item, 'end_date', node.endDate);
  assignText(item, 'previous_start_date', node.previousStartDate);
  assignNormalizedSchemaText(item, 'event_status', node.eventStatus);
  assignNormalizedSchemaText(item, 'attendance_mode', node.eventAttendanceMode);
  assignText(item, 'recipe_yield', node.recipeYield);
  assignText(item, 'prep_time', node.prepTime);
  assignText(item, 'cook_time', node.cookTime);
  assignText(item, 'total_time', node.totalTime);

  const category = arrayValues(node.recipeCategory).map(textValue).filter(Boolean);
  if (category.length > 0) item.recipe_category = category;

  const cuisine = arrayValues(node.recipeCuisine).map(textValue).filter(Boolean);
  if (cuisine.length > 0) item.recipe_cuisine = cuisine;

  const ingredients = arrayValues(node.recipeIngredient).map(textValue).filter(Boolean).slice(0, MAX_LIST_ITEMS);
  if (ingredients.length > 0) item.ingredients = ingredients;

  const instructions = instructionValues(node.recipeInstructions).slice(0, MAX_LIST_ITEMS);
  if (instructions.length > 0) item.instructions = instructions;

  const questions = questionValues(node.mainEntity ?? node.acceptedAnswer, baseUrl).slice(0, MAX_LIST_ITEMS);
  if (questions.length > 0) item.questions = questions;

  const location = placeValue(node.location);
  if (location) item.location = location;

  const organizers = arrayValues(node.organizer).map(entityLabel).filter(Boolean);
  if (organizers.length > 0) item.organizers = organizers;

  const performers = arrayValues(node.performer).map(entityLabel).filter(Boolean);
  if (performers.length > 0) item.performers = performers;

  const rating = ratingValue(node.aggregateRating);
  if (rating) item.rating = rating;

  const offers = offerValues(node.offers, baseUrl);
  if (offers.length > 0) item.offers = offers;

  const hasUsefulData =
    item.name ||
    item.description ||
    item.url ||
    item.images?.length ||
    item.start_date ||
    item.location ||
    item.ingredients?.length ||
    item.instructions?.length ||
    item.questions?.length ||
    item.offers?.length;

  return hasUsefulData ? item : undefined;
}

function typeName(value: unknown): string {
  return arrayValues(value)
    .map((entry) => textValue(entry).replace(/^https?:\/\/schema\.org\//iu, ''))
    .filter(Boolean)
    .join(', ');
}

function textValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  if (isRecord(value)) {
    return (
      textValue(value.name) ||
      textValue(value.headline) ||
      textValue(value.text) ||
      textValue(value.url) ||
      textValue(value['@id'])
    );
  }

  return '';
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function imageValues(value: unknown, baseUrl: string): string[] {
  return arrayValues(value)
    .flatMap((entry) => {
      if (isRecord(entry)) {
        return arrayValues(entry.url ?? entry.contentUrl);
      }

      return [entry];
    })
    .map((entry) => urlValue(entry, baseUrl))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, MAX_IMAGES);
}

function instructionValues(value: unknown): string[] {
  return arrayValues(value)
    .flatMap((entry) => {
      if (isRecord(entry) && Array.isArray(entry.itemListElement)) {
        return instructionValues(entry.itemListElement);
      }

      return [textValue(entry)];
    })
    .filter(Boolean);
}

function questionValues(value: unknown, baseUrl: string): StructuredDataQuestion[] {
  return arrayValues(value)
    .flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      if (Array.isArray(entry.itemListElement)) {
        return questionValues(entry.itemListElement, baseUrl);
      }

      const question = textValue(entry.name || entry.headline || entry.text);
      if (!question) {
        return [];
      }

      const answer = answerValue(entry.acceptedAnswer ?? entry.suggestedAnswer);
      const url = urlValue(entry.url ?? entry['@id'], baseUrl);

      return [
        {
          question,
          answer,
          url,
        },
      ];
    })
    .filter((entry) => entry.question);
}

function answerValue(value: unknown): string | undefined {
  const answers = arrayValues(value).map((entry) => htmlToText(textValue(entry))).filter(Boolean);
  return answers.join(' / ') || undefined;
}

function ratingValue(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rating = textValue(value.ratingValue);
  const count = textValue(value.reviewCount ?? value.ratingCount);

  if (rating && count) {
    return `${rating} (${count} reviews)`;
  }

  return rating || undefined;
}

function offerValues(value: unknown, baseUrl: string): string[] {
  return arrayValues(value)
    .map((offer) => {
      if (!isRecord(offer)) {
        return textValue(offer);
      }

      const price = priceValue(offer);
      const availability = textValue(offer.availability).replace(/^https?:\/\/schema\.org\//iu, '');
      const url = urlValue(offer.url, baseUrl);
      return [price, availability, url].filter(Boolean).join(' - ');
    })
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function priceValue(offer: Record<string, unknown>): string {
  const directPrice = [textValue(offer.priceCurrency), textValue(offer.price)].filter(Boolean).join(' ');
  if (directPrice) {
    return directPrice;
  }

  const specification = offer.priceSpecification;
  if (isRecord(specification)) {
    return [textValue(specification.priceCurrency), textValue(specification.price)].filter(Boolean).join(' ');
  }

  return '';
}

function placeValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeSchemaText(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const name = textValue(value.name);
  const url = textValue(value.url);
  const address = addressValue(value.address);
  return [name, address, url].filter(Boolean).join(' - ') || undefined;
}

function addressValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeSchemaText(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return [
    textValue(value.streetAddress),
    textValue(value.addressLocality),
    textValue(value.addressRegion),
    textValue(value.postalCode),
    textValue(value.addressCountry),
  ]
    .filter(Boolean)
    .join(', ') || undefined;
}

function entityLabel(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeSchemaText(value);
  }

  if (!isRecord(value)) {
    return '';
  }

  const name = textValue(value.name) || textValue(value['@id']);
  const url = textValue(value.url);
  return [name, url].filter(Boolean).join(' - ');
}

function urlValue(value: unknown, baseUrl: string): string | undefined {
  const raw = textValue(value);
  if (!raw) {
    return undefined;
  }

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function assignText<T extends keyof Omit<StructuredDataItem, 'index' | 'type'>>(
  item: Omit<StructuredDataItem, 'index'>,
  key: T,
  value: unknown,
): void {
  const text = textValue(value);
  if (text) {
    (item[key] as string | undefined) = text;
  }
}

function assignNormalizedSchemaText<T extends keyof Omit<StructuredDataItem, 'index' | 'type'>>(
  item: Omit<StructuredDataItem, 'index'>,
  key: T,
  value: unknown,
): void {
  const text = normalizeSchemaText(textValue(value));
  if (text) {
    (item[key] as string | undefined) = text;
  }
}

function appendField(lines: string[], label: string, value?: string): void {
  if (value) {
    lines.push(`- **${label}:** ${value}`);
  }
}

function appendList(lines: string[], label: string, values?: string[], ordered = false): void {
  if (!values || values.length === 0) {
    return;
  }

  lines.push('', `**${label}:**`, '');
  for (const [index, value] of values.entries()) {
    lines.push(ordered ? `${index + 1}. ${value}` : `- ${value}`);
  }
}

function appendQuestions(lines: string[], questions?: StructuredDataQuestion[]): void {
  if (!questions || questions.length === 0) {
    return;
  }

  lines.push('', '**Questions:**', '');
  for (const [index, question] of questions.entries()) {
    lines.push(`${index + 1}. **${question.question}**`);
    if (question.answer) {
      lines.push(`   ${question.answer}`);
    }
    if (question.url) {
      lines.push(`   URL: ${question.url}`);
    }
  }
}

function htmlToText(value: string): string {
  if (!/[<&]/u.test(value)) {
    return value;
  }

  const { document } = parseHTML(`<main>${value}</main>`);
  return (document.querySelector('main')?.textContent ?? value).replace(/\s+/g, ' ').trim();
}

function normalizeSchemaText(value: string): string {
  return value.replace(/^https?:\/\/schema\.org\//iu, '').replace(/^http:\/\/schema\.org\//iu, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
