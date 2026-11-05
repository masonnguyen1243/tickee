import { describe, expect, it } from 'vitest';
import {
  EventForm,
  FORM_QUESTION_FIELDS,
  FORM_QUESTIONS_MAX,
  formOptionKey,
  FormOrderInput,
  FormQuestionInput,
} from '../src/form.js';

const choice = (labels: string[], overrides: Record<string, unknown> = {}) => ({
  label: 'Trình độ',
  kind: 'choice',
  required: true,
  options: labels.map((label) => ({ label })),
  ...overrides,
});
const labelsOf = (n: number) => Array.from({ length: n }, (_, i) => `Phương án ${i + 1}`);
const paths = (value: unknown) => {
  const parsed = FormQuestionInput.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
};
const UUID_A = '019a3b2c-0900-7abc-8def-0123456789ab';
const UUID_B = '019a3b2c-0901-7abc-8def-0123456789ab';

describe('FormQuestionInput', () => {
  it('câu lựa chọn hợp lệ: nhãn trim, phương án giữ id gửi lên', () => {
    expect(
      FormQuestionInput.parse({
        ...choice([]),
        label: '  Trình độ ',
        options: [{ id: UUID_A, label: ' Mới chơi ' }, { label: 'Khá' }],
      }),
    ).toEqual({
      label: 'Trình độ',
      kind: 'choice',
      required: true,
      options: [{ id: UUID_A, label: 'Mới chơi' }, { label: 'Khá' }],
    });
  });

  it('câu văn bản: thiếu options → []; có phương án → lỗi ở options', () => {
    expect(FormQuestionInput.parse({ label: 'Câu lạc bộ', kind: 'text', required: false })).toMatchObject({
      options: [],
    });
    expect(paths({ label: 'Câu lạc bộ', kind: 'text', required: false, options: [{ label: 'A' }] })).toEqual([
      'options',
    ]);
  });

  it('số phương án: 1 và 21 lỗi ở options; 2 và 20 hợp lệ', () => {
    expect(paths(choice(labelsOf(0)))).toEqual(['options']);
    expect(paths(choice(labelsOf(1)))).toEqual(['options']);
    expect(paths(choice(labelsOf(2)))).toEqual([]);
    expect(paths(choice(labelsOf(20)))).toEqual([]);
    expect(paths(choice(labelsOf(21)))).toEqual(['options']);
  });

  it('phương án trùng nhãn (sau trim, không phân biệt hoa thường) → lỗi ở options', () => {
    expect(paths(choice(['Khá', ' khá ']))).toEqual(['options']);
    expect(paths(choice(['Trung bình', 'TRUNG BÌNH', 'Khá']))).toEqual(['options']);
    // Dạng Unicode tổ hợp (NFD) và dựng sẵn (NFC) của cùng chữ là trùng.
    expect(paths(choice(['Khá', 'Khá']))).toEqual(['options']);
    expect(paths(choice(['Khá', 'Kha']))).toEqual([]);
    expect(formOptionKey(' KHÁ ')).toBe(formOptionKey('khá'));
  });

  it('phương án trùng id → lỗi ở options', () => {
    expect(paths({ ...choice([]), options: [{ id: UUID_A, label: 'A' }, { id: UUID_A.toUpperCase(), label: 'B' }] })).toEqual([
      'options',
    ]);
    expect(paths({ ...choice([]), options: [{ id: UUID_A, label: 'A' }, { id: UUID_B, label: 'B' }] })).toEqual([]);
  });

  it('nhãn câu hỏi và nhãn phương án: trống hoặc quá dài → lỗi tại trường', () => {
    expect(paths(choice(['A', 'B'], { label: '  ' }))).toEqual(['label']);
    expect(paths(choice(['A', 'B'], { label: 'x'.repeat(201) }))).toEqual(['label']);
    expect(paths(choice(['A', 'B'], { label: 'x'.repeat(200) }))).toEqual([]);
    expect(paths(choice(['A', '  ']))).toEqual(['options.1.label']);
    expect(paths(choice(['A', 'x'.repeat(101)]))).toEqual(['options.1.label']);
    expect(paths(choice(['A', 'x'.repeat(100)]))).toEqual([]);
  });

  it('loại lạ, thiếu required, options không phải mảng → lỗi tại trường, không ném', () => {
    expect(paths(choice(['A', 'B'], { kind: 'multi' }))).toEqual(['kind']);
    expect(paths({ label: 'A', kind: 'text' })).toEqual(['required']);
    expect(paths({ label: 'A', kind: 'choice', required: true, options: 'A,B' })).toEqual(['options']);
    expect(paths({ label: 'A', kind: 'choice', required: true, options: [{ id: 'abc', label: 'A' }, { label: 'B' }] })).toEqual([
      'options.0.id',
    ]);
  });

  it('FORM_QUESTION_FIELDS khớp các trường của input', () => {
    expect([...FORM_QUESTION_FIELDS]).toEqual(Object.keys(FormQuestionInput.parse(choice(['A', 'B']))));
  });
});

describe('FormOrderInput', () => {
  it('đúng dạng; trùng id (kể cả khác hoa thường) → lỗi ở questionIds', () => {
    expect(FormOrderInput.safeParse({ questionIds: [] }).success).toBe(true);
    expect(FormOrderInput.safeParse({ questionIds: [UUID_A, UUID_B] }).success).toBe(true);
    const duplicated = FormOrderInput.safeParse({ questionIds: [UUID_A, UUID_A.toUpperCase()] });
    expect(duplicated.success ? [] : duplicated.error.issues.map((i) => i.path.join('.'))).toEqual(['questionIds']);
  });

  it('thiếu questionIds, id sai dạng, quá FORM_QUESTIONS_MAX → lỗi, không ném', () => {
    expect(FormOrderInput.safeParse({}).success).toBe(false);
    expect(FormOrderInput.safeParse({ questionIds: ['abc'] }).success).toBe(false);
    const ids = Array.from({ length: FORM_QUESTIONS_MAX + 1 }, (_, i) => `019a3b2c-09${String(i).padStart(2, '0')}-7abc-8def-0123456789ab`);
    expect(FormOrderInput.safeParse({ questionIds: ids }).success).toBe(false);
  });
});

describe('EventForm', () => {
  it('câu hỏi kèm id, position và phương án có id', () => {
    const form = {
      questions: [
        { id: UUID_A, position: 0, label: 'Trình độ', kind: 'choice', required: true, options: [{ id: UUID_B, label: 'Khá' }] },
      ],
    };
    expect(EventForm.parse(form)).toEqual(form);
    expect(EventForm.safeParse({ questions: [{ ...form.questions[0], options: [{ label: 'Khá' }] }] }).success).toBe(false);
  });
});
