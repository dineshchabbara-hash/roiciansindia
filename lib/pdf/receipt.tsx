/**
 * Receipt PDF rendering — @react-pdf/renderer (API_AND_INTEGRATIONS.md
 * §5.1), the same server-side renderer as lib/pdf/certificate.tsx. One
 * template for every payment source (offline and Razorpay): the fields
 * come from lib/domain/receipts.ts's buildReceiptDocument, which maps
 * trusted database rows only. Text-only V1 (no logo), A4 portrait.
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ReceiptDocument } from "@/lib/domain/receipts";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 12,
    marginBottom: 20,
  },
  company: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  muted: {
    color: "#444444",
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  section: {
    marginBottom: 18,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 3,
  },
  label: {
    width: 150,
    color: "#444444",
  },
  value: {
    flexGrow: 1,
    flexShrink: 1,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    paddingTop: 8,
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  footer: {
    marginTop: 28,
    fontSize: 9,
    color: "#444444",
  },
});

function Fields({ rows }: { rows: Array<[string, string]> }) {
  return (
    <View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function ReceiptPdf({ document: doc }: { document: ReceiptDocument }) {
  return (
    <Document title={`Receipt ${doc.receiptNumber}`} author={doc.company.legalName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{doc.company.legalName}</Text>
          {doc.company.addressLines.map((line) => (
            <Text key={line} style={styles.muted}>
              {line}
            </Text>
          ))}
          {doc.company.contactLine && (
            <Text style={styles.muted}>{doc.company.contactLine}</Text>
          )}
          {doc.company.gstin && (
            <Text style={styles.muted}>GSTIN: {doc.company.gstin}</Text>
          )}
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>Payment Receipt</Text>
          <View>
            <Text>Receipt No. {doc.receiptNumber}</Text>
            <Text style={styles.muted}>Receipt date: {doc.receiptDate}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Received from</Text>
          <Fields rows={doc.receivedFrom} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment details</Text>
          <Fields rows={doc.paymentDetails} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Amount ({doc.currency})</Text>
          {doc.amounts.map(([label, value]) => (
            <View key={label} style={styles.amountRow}>
              <Text>{label}</Text>
              <Text>{value}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text>{doc.totalLabel}</Text>
            <Text>{doc.totalAmount}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          This is a computer-generated receipt and does not require a signature.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(document: ReceiptDocument): Promise<Buffer> {
  return renderToBuffer(<ReceiptPdf document={document} />);
}
