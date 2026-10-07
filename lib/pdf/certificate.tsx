/**
 * Certificate PDF rendering — @react-pdf/renderer (API_AND_INTEGRATIONS.md
 * §5.2's own "Recommended... for V1" pick, not a new library choice).
 *
 * Text-only V1 design (no logo image embedding — DECISIONS_NEEDED.md D4's
 * "clean original design authored in Phase 17" default; a future phase can
 * add company_settings.logo_path as an <Image> without changing this
 * module's data contract). Field list is exactly the certificate record's
 * own approved display fields (lib/domain/certificates.ts) plus the two
 * company identity/signatory fields company_settings already carries for
 * this purpose (certificate_signatory_name/_title, legal_name) — never
 * grades, attendance, payment info, Trainer names, or anything not in that
 * list.
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

export type CertificatePdfData = {
  certificateNumber: string;
  studentName: string;
  programName: string;
  completionDate: string;
  issueDate: string;
  companyLegalName: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
};

const styles = StyleSheet.create({
  page: {
    padding: 56,
    fontSize: 12,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  border: {
    flexGrow: 1,
    borderWidth: 2,
    borderColor: "#1a1a1a",
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    marginBottom: 24,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 8,
  },
  studentName: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginVertical: 16,
    textAlign: "center",
  },
  meta: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 32,
    color: "#444444",
  },
  signatureBlock: {
    marginTop: 48,
    alignItems: "center",
  },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    width: 220,
    marginBottom: 6,
  },
});

function CertificateDocument(data: CertificatePdfData) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.border}>
          <Text style={styles.heading}>Certificate of Completion</Text>
          <Text style={styles.body}>This is to certify that</Text>
          <Text style={styles.studentName}>{data.studentName}</Text>
          <Text style={styles.body}>has successfully completed the program</Text>
          <Text style={styles.studentName}>{data.programName}</Text>
          <Text style={styles.body}>Completion Date: {data.completionDate}</Text>
          <Text style={styles.body}>Issue Date: {data.issueDate}</Text>

          {(data.signatoryName || data.signatoryTitle) && (
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine} />
              {data.signatoryName && <Text>{data.signatoryName}</Text>}
              {data.signatoryTitle && <Text>{data.signatoryTitle}</Text>}
            </View>
          )}

          <Text style={styles.meta}>
            {data.companyLegalName} · Certificate No. {data.certificateNumber}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdf(data: CertificatePdfData): Promise<Buffer> {
  return renderToBuffer(<CertificateDocument {...data} />);
}
