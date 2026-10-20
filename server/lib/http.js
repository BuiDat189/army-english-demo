import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const badRequest = (msg, fields) => new HttpError(400, msg, fields ? { fields } : {});
export const notFound = (msg = 'Không tìm thấy dữ liệu.') => new HttpError(404, msg);
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này.') => new HttpError(403, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

/** Kiểm tra dữ liệu bằng zod; lỗi trả về 400 kèm thông báo theo từng trường. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw badRequest('Dữ liệu chưa hợp lệ, vui lòng kiểm tra các trường được đánh dấu.', fields);
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không đúng định dạng JSON.' });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Dữ liệu bị trùng với bản ghi đã có.' });
  }
  console.error('[api-error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Lỗi máy chủ. Vui lòng thử lại.' });
}

// ---- Bộ dựng schema tiếng Việt dùng chung ----
const msg = {
  required: 'Trường này là bắt buộc.',
};
export const v = {
  text: (max = 200, label) => z.string({ error: msg.required }).trim().min(1, label ? `Vui lòng nhập ${label}.` : msg.required).max(max, `Tối đa ${max} ký tự.`),
  optText: (max = 2000) => z.string().trim().max(max, `Tối đa ${max} ký tự.`).optional().nullable().transform((s) => (s ? s : null)),
  phone: () => z.string({ error: 'Vui lòng nhập số điện thoại.' }).trim()
    .transform((s) => s.replace(/[\s.-]/g, ''))
    .refine((s) => /^0\d{9,10}$/.test(s), 'Số điện thoại gồm 10–11 chữ số, bắt đầu bằng 0.'),
  optPhone: () => z.string().trim().optional().nullable()
    .transform((s) => (s ? s.replace(/[\s.-]/g, '') : null))
    .refine((s) => s === null || /^0\d{9,10}$/.test(s), 'Số điện thoại gồm 10–11 chữ số, bắt đầu bằng 0.'),
  optEmail: () => z.string().trim().optional().nullable()
    .transform((s) => (s ? s.toLowerCase() : null))
    .refine((s) => s === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), 'Email không hợp lệ.'),
  date: (label = 'ngày') => z.string({ error: `Vui lòng chọn ${label}.` }).refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, `Vui lòng chọn ${label} hợp lệ.`),
  optDate: () => z.string().optional().nullable().transform((s) => (s ? s : null))
    .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Ngày không hợp lệ.'),
  time: (label = 'giờ') => z.string({ error: `Vui lòng nhập ${label}.` }).refine((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s), `${label[0].toUpperCase()}${label.slice(1)} không hợp lệ (HH:MM).`),
  id: (label = 'mục') => z.coerce.number({ error: `Vui lòng chọn ${label}.` }).int().positive(`Vui lòng chọn ${label}.`),
  optId: () => z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).optional().transform((x) => (x ? Number(x) : null)),
  /** Tiền VNĐ: số nguyên dương, chặn số âm, số thập phân và giá trị phi lý */
  money: (label = 'số tiền', { allowZero = false } = {}) => z.coerce.number({ error: `Vui lòng nhập ${label}.` })
    .refine((n) => Number.isFinite(n), `${cap(label)} không hợp lệ.`)
    .refine((n) => Number.isInteger(n), `${cap(label)} phải là số nguyên (VNĐ).`)
    .refine((n) => (allowZero ? n >= 0 : n > 0), allowZero ? `${cap(label)} không được âm.` : `${cap(label)} phải lớn hơn 0.`)
    .refine((n) => n <= 10_000_000_000, `${cap(label)} vượt quá giới hạn cho phép.`),
  int: (min, max, label = 'giá trị') => z.coerce.number({ error: `Vui lòng nhập ${label}.` }).int(`${cap(label)} phải là số nguyên.`).min(min, `${cap(label)} tối thiểu là ${min}.`).max(max, `${cap(label)} tối đa là ${max}.`),
  enum: (values, label = 'giá trị') => z.enum(values, { error: `Vui lòng chọn ${label}.` }),
};
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Bọc handler async (Express 5 đã tự bắt lỗi promise, giữ hàm này cho rõ ràng) */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
