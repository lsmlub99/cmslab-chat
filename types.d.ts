declare module "pdf-parse" { const parse: (data: Buffer, options?: { pagerender?: (page: any) => Promise<string> }) => Promise<{ text: string; numpages: number }>; export default parse; }
declare module "mammoth" { const mammoth: { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> }; export default mammoth; }
