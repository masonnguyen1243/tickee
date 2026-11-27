import { describe, expect, it } from 'vitest';
import { CSV_BOM, CSV_DELIMITER, CSV_LINE_END, csvCell, csvDigitsAsText, csvRow } from '../src/csv.js';

/* Story 6.3: chuẩn CSV dùng chung (BOM, thoát ô, dòng) — 6.3 và 7.2 dùng lại. */

describe('hằng của file', () => {
  it('BOM là EF BB BF trong UTF-8; phân cách dấu phẩy; dòng CRLF', () => {
    expect([...Buffer.from(CSV_BOM, 'utf8')]).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_DELIMITER).toBe(',');
    expect(CSV_LINE_END).toBe('\r\n');
  });
});

describe('csvCell', () => {
  it('ô thường giữ nguyên, kể cả tiếng Việt và khoảng trắng', () => {
    expect(csvCell('Nguyễn Văn Minh')).toBe('Nguyễn Văn Minh');
    expect(csvCell('0912 345 678')).toBe('0912 345 678');
    expect(csvCell('2 × VIP')).toBe('2 × VIP');
    expect(csvCell('')).toBe('');
  });

  it('null/undefined → ô trống; số → nguyên văn, không thoát', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(300_000)).toBe('300000');
    expect(csvCell(0)).toBe('0');
    expect(() => csvCell(Number.NaN)).toThrow();
    expect(() => csvCell(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('ô nguy hiểm (=, +, -, @, tab, CR ở đầu) → thêm \' ở đầu', () => {
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('+84912345678')).toBe("'+84912345678");
    expect(csvCell('@a')).toBe("'@a");
    expect(csvCell('\tb')).toBe("'\tb");
    expect(csvCell('=1+1')).toBe("'=1+1");
    // Ký tự đó ở giữa ô thì không sao.
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('x-1')).toBe('x-1');
  });

  it('=HYPERLINK("x") → thoát công thức rồi bọc ngoặc kép, " nhân đôi', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('CR ở đầu: thoát công thức rồi bọc vì có CR', () => {
    expect(csvCell('\rb')).toBe(`"'\rb"`);
  });

  it('ô có dấu phẩy, ngoặc kép, xuống dòng → bọc "…", " nhân đôi, giữ nguyên xuống dòng', () => {
    expect(csvCell('A, "B"\nC')).toBe('"A, ""B""\nC"');
    expect(csvCell('dòng 1\r\ndòng 2')).toBe('"dòng 1\r\ndòng 2"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('nói "chào"')).toBe('"nói ""chào"""');
  });
});

describe('csvRow', () => {
  it('nối ô bằng dấu phẩy, kết thúc CRLF; ô trống giữ vị trí', () => {
    expect(csvRow(['TK8F3Q2AXM', 'Minh', null, 300_000, '-1'])).toBe("TK8F3Q2AXM,Minh,,300000,'-1\r\n");
    expect(csvRow([])).toBe('\r\n');
    expect(csvRow(['a, b', '@x'])).toBe(`"a, b",'@x\r\n`);
  });
});

describe('csvDigitsAsText (câu trả lời form toàn chữ số)', () => {
  it("bắt đầu bằng 0 hoặc từ 12 chữ số → thêm ' ở đầu; số ngắn, chữ khác, null giữ nguyên", () => {
    expect(csvDigitsAsText('001203004567')).toBe("'001203004567");
    expect(csvDigitsAsText('0987654321')).toBe("'0987654321");
    expect(csvDigitsAsText('123456789012')).toBe("'123456789012");
    expect(csvDigitsAsText('42')).toBe('42');
    expect(csvDigitsAsText('12345678901')).toBe('12345678901');
    expect(csvDigitsAsText('0')).toBe("'0");
    expect(csvDigitsAsText('0912 345 678')).toBe('0912 345 678');
    expect(csvDigitsAsText('Size L')).toBe('Size L');
    expect(csvDigitsAsText('')).toBe('');
    expect(csvDigitsAsText(null)).toBeNull();
  });

  it('qua csvCell: ô giữ dấu \' và không bị bọc ngoặc kép', () => {
    expect(csvRow([csvDigitsAsText('001203004567'), csvDigitsAsText('42')])).toBe("'001203004567,42\r\n");
  });
});
