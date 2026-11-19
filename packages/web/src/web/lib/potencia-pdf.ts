/**
 * PDF do simulador de potência a contratar (jsPDF, A4 vertical, margens de 15 mm).
 *
 * Segue o design das propostas Iberdrola / RZ Energy: logos no cabeçalho, linha
 * verde, caixa verde-clara com o resultado e escalões em kVA.
 * Importante: o PDF nunca mostra watts — só kVA.
 *
 * O jsPDF é importado dinamicamente para não pesar no arranque da app.
 */
import { ESCALOES, LIMIAR_TRIFASICO, POTENCIA_MAX, fmtEur, fmtKva, type ItemPotencia, type Resultado } from "./potencia";

const VERDE = [0, 166, 80] as const;
const VERDE_CLARO = [230, 245, 236] as const;
const NEUTRO = [244, 247, 245] as const;
const TEXTO = [15, 42, 29] as const;
const CINZA = [110, 120, 115] as const;

const MARGEM = 15; // mm
const LARGURA = 210;
const ALTURA = 297;
const UTIL = LARGURA - MARGEM * 2; // 180 mm

let cacheLogos: { iberdrola: string; rz: string } | null = null;

async function dataUrl(src: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Não foi possível carregar ${src}`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function logos() {
  if (!cacheLogos) {
    const [iberdrola, rz] = await Promise.all([
      dataUrl("/logos/iberdrola-colaborador.png"),
      dataUrl("/logos/rzenergy.png"),
    ]);
    cacheLogos = { iberdrola, rz };
  }
  return cacheLogos;
}

export type PdfDados = {
  itens: ItemPotencia[];
  margem: number;
  resultado: Resultado;
  /** Preço da potência em €/dia, quando indicado. */
  precoDia: number | null;
};

export async function gerarPdfPotencia({ itens, margem, resultado, precoDia }: PdfDados): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const img = await logos();

  const hoje = new Date();
  const data = `${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;

  // ---------------------------------------------------------------- cabeçalho
  // Iberdrola 1024x232 -> 40 mm de largura; RZ 1567x684 -> 30 mm.
  doc.addImage(img.iberdrola, "PNG", MARGEM, MARGEM, 40, 40 * (232 / 1024));
  doc.addImage(img.rz, "PNG", LARGURA - MARGEM - 32, MARGEM + 1, 32, 32 * (684 / 1567));

  let y = MARGEM + 16;
  doc.setDrawColor(...VERDE);
  doc.setLineWidth(0.7);
  doc.line(MARGEM, y, LARGURA - MARGEM, y);
  y += 11;

  // ---------------------------------------------------------------- título
  doc.setTextColor(...TEXTO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Simulador de potência a contratar", MARGEM, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CINZA);
  doc.text(`Data: ${data}`, LARGURA - MARGEM, y, { align: "right" });
  y += 12;

  // ---------------------------------------------------------------- contexto
  const considerados = itens.length;
  const emUso = itens.filter((i) => i.emUso);
  const contexto: [string, string][] = [
    ["Equipamentos considerados", String(considerados)],
    ["Equipamentos em uso", String(emUso.length)],
    ["Margem de segurança", `${margem} %`],
  ];
  doc.setFontSize(9.5);
  for (const [rotulo, valor] of contexto) {
    doc.setTextColor(...CINZA);
    doc.text(`${rotulo}:`, MARGEM, y);
    doc.setTextColor(...TEXTO);
    doc.setFont("helvetica", "bold");
    doc.text(valor, MARGEM + 45, y);
    doc.setFont("helvetica", "normal");
    y += 6;
  }
  y += 3;

  // ---------------------------------------------------------------- caixa do resultado
  const caixaH = 24;
  doc.setFillColor(...VERDE_CLARO);
  doc.setDrawColor(...VERDE);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGEM, y, UTIL, caixaH, 3, 3, "FD");
  doc.setTextColor(...TEXTO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const recomendada = resultado.recomendada;
  doc.text(
    recomendada == null ? "Potência recomendada: acima de 20,7 kVA" : `Potência recomendada: ${fmtKva(recomendada)} kVA`,
    MARGEM + 6,
    y + 10,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...CINZA);
  doc.text(`Necessidade estimada com margem: ${fmtKva(Math.round(resultado.necessario * 100) / 100)} kVA`, MARGEM + 6, y + 17.5);
  if (precoDia != null && recomendada != null) {
    doc.text(`Custo estimado da potência: ${fmtEur(precoDia * 30)}/mês (30 dias)`, MARGEM + 6, y + 21.8);
  }
  y += caixaH + 10;

  // ---------------------------------------------------------------- tabela
  const c0 = MARGEM;
  const c1 = MARGEM + 12;
  const c2 = MARGEM + 132;
  const c3 = MARGEM + 152;
  const linhaH = 7;

  const cabecalho = () => {
    doc.setFillColor(...VERDE);
    doc.rect(MARGEM, y, UTIL, linhaH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("#", c0 + 3, y + 4.7);
    doc.text("Equipamento", c1 + 3, y + 4.7);
    doc.text("Qtd.", c2 + 3, y + 4.7);
    doc.text("Em uso", c3 + 3, y + 4.7);
    y += linhaH;
  };
  cabecalho();

  doc.setFontSize(9);
  itens.forEach((item, i) => {
    if (y + linhaH > ALTURA - MARGEM - 45) {
      doc.addPage();
      y = MARGEM;
      cabecalho();
      doc.setFontSize(9);
    }
    if (i % 2 === 1) {
      doc.setFillColor(...NEUTRO);
      doc.rect(MARGEM, y, UTIL, linhaH, "F");
    }
    if (item.emUso) {
      doc.setTextColor(...TEXTO);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(...CINZA);
      doc.setFont("helvetica", "normal");
    }
    doc.text(String(i + 1), c0 + 3, y + 4.7);
    doc.text(item.nome, c1 + 3, y + 4.7);
    doc.text(String(item.qtd), c2 + 3, y + 4.7);
    doc.text(item.emUso ? "Sim" : "Não", c3 + 3, y + 4.7);
    y += linhaH;
  });

  doc.setDrawColor(...NEUTRO);
  doc.setLineWidth(0.3);
  doc.rect(MARGEM, y - itens.length * linhaH - linhaH, UTIL, itens.length * linhaH + linhaH, "S");
  y += 8;

  // ---------------------------------------------------------------- escalões
  if (y + 18 > ALTURA - MARGEM) {
    doc.addPage();
    y = MARGEM;
  }
  doc.setTextColor(...TEXTO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Escalões de potência (kVA)", MARGEM, y);
  y += 4;

  const gap = 2;
  const larguraEscalao = (UTIL - gap * (ESCALOES.length - 1)) / ESCALOES.length;
  doc.setFontSize(8);
  ESCALOES.forEach((e, i) => {
    const x = MARGEM + i * (larguraEscalao + gap);
    const ativo = recomendada != null && Math.abs(e - recomendada) < 1e-9;
    if (ativo) {
      doc.setFillColor(...VERDE);
      doc.setDrawColor(...VERDE);
    } else {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(210, 218, 212);
    }
    doc.roundedRect(x, y, larguraEscalao, 8, 1.5, 1.5, "FD");
    if (ativo) doc.setTextColor(255, 255, 255);
    else doc.setTextColor(...CINZA);
    doc.setFont("helvetica", ativo ? "bold" : "normal");
    doc.text(fmtKva(e), x + larguraEscalao / 2, y + 5.2, { align: "center" });
  });
  y += 16;

  // ---------------------------------------------------------------- observações
  const notas: string[] = [];
  if (resultado.semEscalao) {
    notas.push(`Acima de ${fmtKva(POTENCIA_MAX)} kVA é necessário contrato em média tensão ou avaliar o fornecimento com o operador.`);
  }
  if (recomendada != null && recomendada >= LIMIAR_TRIFASICO) {
    notas.push(`A partir de ${fmtKva(LIMIAR_TRIFASICO)} kVA pode ser necessária ligação trifásica.`);
  }
  if (resultado.excede) notas.push("Atenção: o consumo simultâneo excede a potência.");
  notas.push("Estimativa indicativa (1 kW considerado igual a 1 kVA). As condições finais devem ser confirmadas com o comercializador.");

  if (y + 8 + notas.length * 5 > ALTURA - MARGEM) {
    doc.addPage();
    y = MARGEM;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEXTO);
  doc.text("Observações", MARGEM, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  for (const n of notas) {
    for (const linha of doc.splitTextToSize(n, UTIL) as string[]) {
      if (y > ALTURA - MARGEM) {
        doc.addPage();
        y = MARGEM;
      }
      doc.text(linha, MARGEM, y);
      y += 4.4;
    }
  }

  doc.save("simulacao-potencia.pdf");
}
