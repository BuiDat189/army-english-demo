import { useState } from 'react';
import { FileSpreadsheet, Download, Upload, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { phone } from '../../lib/format.js';
import { Modal, Button, Alert, Badge, Spinner, useToast } from '../../components/ui/index.js';

// Cột của file mẫu (tiếng Việt) → khóa gửi lên máy chủ
const COLUMNS = [
  ['student_name', 'Họ tên học viên'], ['dob', 'Ngày sinh'], ['gender', 'Giới tính'], ['school', 'Trường'],
  ['parent_name', 'Họ tên phụ huynh'], ['phone', 'Số điện thoại'], ['relationship', 'Quan hệ'], ['parent_email', 'Email phụ huynh'],
  ['note', 'Ghi chú'], ['tags', 'Tag'],
];
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_MAP = Object.fromEntries(COLUMNS.flatMap(([k, label]) => [[fold(label), k], [fold(k), k]]));
Object.assign(HEADER_MAP, { hoten: 'student_name', tenhocvien: 'student_name', phuhuynh: 'parent_name', sdt: 'phone', dienthoai: 'phone', email: 'parent_email', tags: 'tags' });

const BOM_RE = new RegExp(`^${String.fromCharCode(0xfeff)}`);
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true; else if (c === ',' || c === ';') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}
const cellText = (v) => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return v === null || v === undefined ? '' : String(v).trim();
};

function downloadTemplate() {
  const sample = [COLUMNS.map((c) => c[1]), ['Nguyễn Minh An', '15/03/2016', 'Nam', 'TH Kim Đồng', 'Trần Thị Hoa', '0000 123 456', 'Mẹ', 'hoa@example.com', 'Học thử trước đó', 'Anh chị em']];
  const csv = sample.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mau-nhap-hoc-vien.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Nhập học viên hàng loạt từ Excel (.xlsx) hoặc CSV: đọc file trên trình duyệt → máy chủ kiểm tra → nhập các dòng hợp lệ */
export default function ImportStudentsModal({ open, onOpenChange, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [check, setCheck] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setFile(null); setRows(null); setCheck(null); setErr(null); };

  const onFile = async (f) => {
    reset();
    if (!f) return;
    setFile(f); setBusy(true);
    try {
      let table;
      if (/\.xlsx$/i.test(f.name)) {
        const { default: readXlsxFile } = await import('read-excel-file');
        table = (await readXlsxFile(f)).map((r) => r.map(cellText));
      } else if (/\.csv$/i.test(f.name)) {
        table = parseCsv((await f.text()).replace(BOM_RE, ''));
      } else throw new Error('Chỉ nhận file Excel (.xlsx) hoặc CSV.');
      if (table.length < 2) throw new Error('File không có dòng dữ liệu (dòng đầu tiên là tiêu đề cột).');
      const keys = table[0].map((h) => HEADER_MAP[fold(h)] || null);
      if (!keys.includes('student_name') || !keys.includes('phone')) throw new Error('Không tìm thấy cột "Họ tên học viên" hoặc "Số điện thoại". Dùng file mẫu để đúng tên cột.');
      const data = table.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? '']).filter(([k]) => k)));
      if (data.length > 1000) throw new Error('Mỗi lần nhập tối đa 1000 dòng.');
      setRows(data);
      setCheck(await api.post('/api/students/import', { rows: data, commit: false }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/api/students/import', { rows, commit: true });
      toast.success(`Đã nhập ${r.created} học viên.${r.invalid ? ` Bỏ qua ${r.invalid} dòng lỗi.` : ''}`);
      reset(); onOpenChange(false); onDone?.();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }} size="xl" title="Nhập học viên từ file"
      description="Dòng đầu là tiêu đề cột. Hệ thống kiểm tra từng dòng trước khi nhập; chỉ các dòng hợp lệ được tạo. Số điện thoại trùng phụ huynh có sẵn sẽ liên kết vào phụ huynh đó (anh chị em)."
      footer={<>
        <Button variant="ghost" icon={Download} onClick={downloadTemplate} className="mr-auto">Tải file mẫu</Button>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Đóng</Button>
        <Button icon={Upload} loading={busy && !!check} disabled={!check?.valid} onClick={commit}>Nhập {check?.valid || 0} dòng hợp lệ</Button>
      </>}>
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-line-strong px-4 py-6 text-center hover:border-brand-400 hover:bg-brand-50/40">
          <FileSpreadsheet className="size-8 text-brand-700" aria-hidden />
          <span className="text-sm font-medium">{file ? file.name : 'Chọn file Excel (.xlsx) hoặc CSV'}</span>
          <span className="text-xs text-ink-3">Cột bắt buộc: Họ tên học viên, Họ tên phụ huynh, Số điện thoại. Ngày sinh dạng dd/mm/yyyy.</span>
          <input type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Chọn file nhập học viên" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {busy && !check && <div className="flex items-center gap-2 text-sm text-ink-3"><Spinner className="size-4" />Đang đọc và kiểm tra file…</div>}
        {err && <Alert tone="danger">{err.message}</Alert>}
        {check && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="success">{check.valid} dòng hợp lệ</Badge>
              {check.invalid > 0 && <Badge tone="danger">{check.invalid} dòng lỗi (sẽ bỏ qua)</Badge>}
              {check.results.some((x) => x.ok && x.warnings.length) && <Badge tone="warning">{check.results.filter((x) => x.ok && x.warnings.length).length} dòng có lưu ý</Badge>}
            </div>
            <div className="scroll-thin max-h-80 overflow-auto rounded-[var(--radius-control)] border border-line">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-canvas text-left text-xs text-ink-3"><tr><th className="px-3 py-2 font-medium">Dòng</th><th className="px-3 py-2 font-medium">Học viên</th><th className="px-3 py-2 font-medium">Phụ huynh</th><th className="px-3 py-2 font-medium">Kết quả kiểm tra</th></tr></thead>
                <tbody>
                  {check.results.map((x) => (
                    <tr key={x.row} className="border-t border-line/70 align-top">
                      <td className="px-3 py-2 tabular text-ink-3">{x.row + 1}</td>
                      <td className="px-3 py-2"><span className="font-medium">{x.data.student_name || '—'}</span>{x.data.dob && x.data.dob !== 'invalid' && <span className="block text-xs text-ink-3">{x.data.dob.split('-').reverse().join('/')}</span>}</td>
                      <td className="px-3 py-2">{x.data.parent_name || '—'}<span className="block text-xs text-ink-3 tabular">{x.data.phone ? phone(x.data.phone) : ''}</span></td>
                      <td className="px-3 py-2">
                        {x.errors.map((m) => <p key={m} className="flex items-start gap-1 text-red-700"><XCircle className="mt-0.5 size-3.5 shrink-0" />{m}</p>)}
                        {x.warnings.map((m) => <p key={m} className="flex items-start gap-1 text-amber-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{m}</p>)}
                        {x.ok && !x.warnings.length && <p className="flex items-center gap-1 text-brand-700"><CheckCircle2 className="size-3.5" />Hợp lệ</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
