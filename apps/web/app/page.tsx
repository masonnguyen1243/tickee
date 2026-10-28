import { ErrorCode } from '@tickee/contracts';

export default function HomePage() {
  return (
    <main>
      <h1>tickee</h1>
      <p>Nền móng đã sẵn sàng. Mã lỗi dùng chung: {Object.keys(ErrorCode).length}.</p>
    </main>
  );
}
