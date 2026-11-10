import { randomInt } from 'node:crypto';
import { ORDER_CODE_ALPHABET, ORDER_CODE_PREFIX, ORDER_CODE_RANDOM_LENGTH } from '@tickee/contracts';

/** Token DI của hàm sinh mã Đơn (test tiêm hàm cố định để ép trùng mã). */
export const ORDER_CODE_GENERATOR = Symbol('ORDER_CODE_GENERATOR');
export type OrderCodeGenerator = () => string;

/** Mã Đơn `TK` + 8 ký tự Crockford base32 (CSPRNG, ~40 bit). Trùng (unique `orders_code_key`) thì người gọi sinh lại. */
export const randomOrderCode: OrderCodeGenerator = () => {
  let code = ORDER_CODE_PREFIX;
  for (let i = 0; i < ORDER_CODE_RANDOM_LENGTH; i++) code += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
  return code;
};

/** Tối đa chừng này lần thử mã (lần đầu + sinh lại khi trùng) trước khi bỏ cuộc. */
export const ORDER_CODE_ATTEMPTS = 3;
