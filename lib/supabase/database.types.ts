/**
 * Hand-authored Supabase database types, covering only the tables/views
 * Phase 3/4 read. This project has no live Supabase project to run
 * `supabase gen types typescript` against yet (see IMPLEMENTATION_PLAN.md
 * Phase 2/3 verification reports) — these types are transcribed directly
 * from the migrations in supabase/migrations/, kept in the same
 * `Database.public.Tables.<table>.Row` shape the real codegen produces, so
 * replacing this file with a generated one later is a drop-in swap, not a
 * rewrite of call sites. Extend this file (don't hand-roll ad hoc types
 * elsewhere) as later phases read more tables.
 *
 * Every table/view below fully satisfies @supabase/postgrest-js's
 * `GenericTable`/`GenericView`/`GenericSchema` shape (Row + Insert + Update
 * + Relationships per table; Row + Relationships per view; Functions
 * present even if empty) — omitting any of these silently makes
 * `SupabaseClient<Database>` fall back to `never` for every table, not just
 * the incomplete one, which is a genuinely confusing failure mode to debug.
 * Insert/Update are approximated as `Partial<Row>` since no code path in
 * this project yet writes through the typed client to these tables (all
 * writes so far are either RLS self-service on `students`, handled without
 * needing precise Insert types, or service-role scripts that don't use
 * this generic at all) — tighten these if/when a later phase needs to.
 */

type GenericRelationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};
type Relationships = GenericRelationship[];

/** Phase 22A website document kinds (code templates own rendering). */
export type WebsiteDocumentKind =
  | "home"
  | "about"
  | "corporate_training"
  | "institutions"
  | "contact"
  | "legal"
  | "navigation"
  | "footer"
  | "program"
  // 20260101000042: editable copy of the Programs and Upcoming Batches pages
  | "programs_listing"
  | "upcoming_batches";

/** Phase 22A public Batch registration state (P22-10). */
export type WebsiteRegistrationState = "open" | "closed" | "full";

export type Database = {
  public: {
    Tables: {
      user_roles: {
        Row: {
          id: string;
          auth_user_id: string;
          role: "super_admin" | "admin" | "trainer" | "student";
        };
        Insert: Partial<Database["public"]["Tables"]["user_roles"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["user_roles"]["Row"]>;
        Relationships: Relationships;
      };
      admins: {
        Row: {
          id: string;
          auth_user_id: string;
          first_name: string;
          last_name: string;
          email: string;
          role_level: "admin" | "super_admin";
          status: "active" | "inactive";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["admins"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["admins"]["Row"]>;
        Relationships: Relationships;
      };
      company_settings: {
        Row: {
          id: string;
          singleton: boolean;
          company_name: string;
          legal_name: string;
          logo_path: string | null;
          address: string | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          country: string;
          gstin: string | null;
          tax_enabled: boolean;
          default_tax_rate_percent: string;
          tax_label: string;
          student_id_prefix: string;
          receipt_number_format: string;
          program_code_pattern: string | null;
          certificate_number_format: string;
          certificate_signatory_name: string | null;
          certificate_signatory_title: string | null;
          social_links: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["company_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["company_settings"]["Row"]>;
        Relationships: Relationships;
      };
      students: {
        Row: {
          id: string;
          student_code: string;
          auth_user_id: string | null;
          first_name: string;
          last_name: string;
          preferred_name: string | null;
          email: string | null;
          phone: string;
          alternate_phone: string | null;
          date_of_birth: string | null;
          gender: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          country: string;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          registration_date: string;
          status: "active" | "inactive" | "archived";
          profile_photo_path: string | null;
          lead_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["students"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["students"]["Row"]>;
        Relationships: Relationships;
      };
      student_notes: {
        Row: {
          id: string;
          student_id: string;
          note: string;
          created_by: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["student_notes"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["student_notes"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "student_notes_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      student_documents: {
        Row: {
          id: string;
          student_id: string;
          document_type: string;
          file_path: string;
          uploaded_by: string;
          uploaded_by_type: "admin" | "student";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["student_documents"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["student_documents"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "student_documents_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_auth_user_id: string | null;
          actor_role: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          before_data: Record<string, unknown> | null;
          after_data: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
        Relationships: Relationships;
      };
      attendance: {
        Row: {
          id: string;
          class_session_id: string;
          enrollment_id: string;
          student_id: string;
          batch_id: string;
          status: "present" | "absent" | "late" | "excused";
          marked_by: string;
          marked_by_type: "trainer" | "admin";
          marked_at: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["attendance"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["attendance"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "attendance_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_audit: {
        Row: {
          id: string;
          attendance_id: string;
          changed_by: string;
          changed_by_type: "trainer" | "admin";
          previous_status: string | null;
          new_status: string | null;
          changed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["attendance_audit"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["attendance_audit"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "attendance_audit_attendance_id_fkey";
            columns: ["attendance_id"];
            isOneToOne: false;
            referencedRelation: "attendance";
            referencedColumns: ["id"];
          },
        ];
      };
      certificates: {
        Row: {
          id: string;
          certificate_number: string;
          enrollment_id: string;
          student_id: string;
          program_id: string;
          completion_date: string;
          issue_date: string;
          status: "issued" | "revoked";
          pdf_path: string;
          revoked_reason: string | null;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["certificates"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["certificates"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "certificates_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "certificates_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          recipient_auth_user_id: string;
          created_by_auth_user_id: string | null;
          type: string;
          title: string;
          body: string | null;
          data: Record<string, unknown>;
          channel: "in_app" | "email" | "whatsapp";
          status: "unread" | "read";
          read_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
        Relationships: [];
      };
      trainers: {
        Row: {
          id: string;
          auth_user_id: string;
          first_name: string;
          last_name: string;
          email: string;
          phone: string | null;
          bio: string | null;
          specialization: string[];
          status: "active" | "inactive";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["trainers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["trainers"]["Row"]>;
        Relationships: Relationships;
      };
      // Phase 6 (Trainer Management) reads this many-to-many table, joined
      // to batches/programs for a trainer's read-only assignment history —
      // see supabase/migrations/20260101000005_catalog_tables.sql.
      batch_trainers: {
        Row: {
          id: string;
          batch_id: string;
          trainer_id: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["batch_trainers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["batch_trainers"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "batch_trainers_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "batch_trainers_trainer_id_fkey";
            columns: ["trainer_id"];
            isOneToOne: false;
            referencedRelation: "trainers";
            referencedColumns: ["id"];
          },
        ];
      };
      programs: {
        Row: {
          id: string;
          program_code: string;
          name: string;
          description: string | null;
          category: string | null;
          duration_value: number | null;
          duration_unit: "hours" | "days" | "weeks" | "months" | null;
          delivery_mode: "online" | "in_person" | "hybrid" | null;
          regular_fee: string;
          registration_fee: string;
          tax_rate_percent: string | null;
          status: "draft" | "active" | "inactive" | "archived";
          thumbnail_path: string | null;
          certificate_eligible: boolean;
          installments_allowed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["programs"]["Row"]>;
        Relationships: Relationships;
      };
      batches: {
        Row: {
          id: string;
          program_id: string;
          name: string;
          start_date: string;
          expected_end_date: string | null;
          days_of_week: string[];
          start_time: string | null;
          end_time: string | null;
          timezone: string;
          delivery_mode: "online" | "in_person" | "hybrid" | null;
          capacity: number | null;
          status:
            "draft" | "upcoming" | "active" | "completed" | "cancelled" | "archived";
          meeting_link: string | null;
          location: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["batches"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["batches"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "batches_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
        ];
      };
      enrollments: {
        Row: {
          id: string;
          enrollment_code: string;
          student_id: string;
          program_id: string;
          batch_id: string | null;
          enrollment_date: string;
          status:
            | "lead"
            | "applicant"
            | "enrolled"
            | "active"
            | "on_hold"
            | "completed"
            | "withdrawn"
            | "cancelled";
          regular_fee: string;
          agreed_fee: string;
          discount_amount: string;
          discount_reason: string | null;
          registration_fee: string;
          tax_amount: string;
          total_payable: string;
          amount_paid_cache: string;
          outstanding_balance_cache: string;
          payment_plan_type: "full" | "installments" | null;
          source: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["enrollments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["enrollments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "enrollments_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          payment_code: string;
          enrollment_id: string;
          // Added Phase 14 — the column already existed
          // (20260101000007_payment_tables.sql) but this hand-authored type
          // omitted it until a Phase 14 query needed it (see this file's own
          // header comment: "extend this file as later phases read more
          // tables"). Nullable, ON DELETE SET NULL — a payment is not
          // required to be tied to a specific installment.
          installment_id: string | null;
          total_amount: string;
          status:
            | "pending"
            | "authorized"
            | "paid"
            | "failed"
            | "refunded"
            | "partially_refunded"
            | "cancelled";
          method: "razorpay" | "cash" | "bank_transfer" | "upi" | "cheque" | "other";
          created_at: string;
          paid_at: string | null;
          // Added Phase 20A (Offline Payments Ledger) — columns that already
          // existed (20260101000007) and are now read by the ledger.
          student_id: string;
          payment_type: "registration" | "full" | "installment" | "partial" | "other";
          amount: string;
          tax_amount: string;
          internal_reference: string | null;
          notes: string | null;
          created_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["payments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "payments_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: false;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_installment_id_fkey";
            columns: ["installment_id"];
            isOneToOne: false;
            referencedRelation: "installments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
      // Phase 21A (Receipts) — 20260101000007 / 20260101000037. Written only
      // by issue_receipt() (service_role); end users read through RLS.
      receipts: {
        Row: {
          id: string;
          receipt_number: string;
          payment_id: string;
          pdf_path: string;
          pdf_generated_at: string | null;
          emailed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["receipts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["receipts"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "receipts_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: true;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_refunds: {
        Row: {
          id: string;
          payment_id: string;
          amount: string;
          status: "initiated" | "processed" | "failed";
          // Added Phase 21B (20260101000038) — written only through the
          // refund functions; end users read through RLS.
          reason: string;
          reference: string | null;
          refunded_on: string | null;
          razorpay_refund_id: string | null;
          initiated_by: string | null;
          processed_at: string | null;
          failed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_refunds"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["payment_refunds"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "payment_refunds_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_initiated_by_fkey";
            columns: ["initiated_by"];
            isOneToOne: false;
            referencedRelation: "admins";
            referencedColumns: ["id"];
          },
        ];
      };
      program_modules: {
        Row: {
          id: string;
          program_id: string;
          title: string;
          description: string | null;
          sequence: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["program_modules"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["program_modules"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "program_modules_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
        ];
      };
      materials: {
        Row: {
          id: string;
          program_id: string | null;
          batch_id: string | null;
          module_id: string | null;
          class_session_id: string | null;
          title: string;
          description: string | null;
          material_type: "file" | "link" | "video";
          file_path: string | null;
          external_url: string | null;
          uploaded_by: string;
          uploaded_by_type: "admin" | "trainer";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["materials"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["materials"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "materials_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "materials_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "materials_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "program_modules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "materials_class_session_id_fkey";
            columns: ["class_session_id"];
            isOneToOne: false;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      assignments: {
        Row: {
          id: string;
          program_id: string;
          batch_id: string;
          module_id: string | null;
          trainer_id: string;
          title: string;
          description: string | null;
          attachment_path: string | null;
          assigned_date: string;
          due_date: string;
          max_marks: string | null;
          status: "active" | "closed";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["assignments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["assignments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "assignments_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignments_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignments_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "program_modules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignments_trainer_id_fkey";
            columns: ["trainer_id"];
            isOneToOne: false;
            referencedRelation: "trainers";
            referencedColumns: ["id"];
          },
        ];
      };
      assignment_submissions: {
        Row: {
          id: string;
          assignment_id: string;
          enrollment_id: string;
          student_id: string;
          submitted_at: string | null;
          text_response: string | null;
          file_path: string | null;
          status:
            | "not_submitted"
            | "submitted"
            | "late"
            | "reviewed"
            | "resubmission_requested";
          marks: string | null;
          trainer_feedback: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["assignment_submissions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["assignment_submissions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "assignment_submissions_assignment_id_fkey";
            columns: ["assignment_id"];
            isOneToOne: false;
            referencedRelation: "assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_submissions_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: false;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_submissions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "trainers";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_plans: {
        Row: {
          id: string;
          enrollment_id: string;
          total_amount: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payment_plans"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["payment_plans"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "payment_plans_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: true;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
        ];
      };
      installments: {
        Row: {
          id: string;
          payment_plan_id: string;
          sequence: number;
          label: string | null;
          amount: string;
          due_date: string;
          status: "upcoming" | "due" | "partially_paid" | "paid" | "overdue" | "waived";
          amount_paid_cache: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["installments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["installments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "installments_payment_plan_id_fkey";
            columns: ["payment_plan_id"];
            isOneToOne: false;
            referencedRelation: "payment_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      class_sessions: {
        Row: {
          id: string;
          batch_id: string;
          trainer_id: string | null;
          session_date: string;
          start_time: string | null;
          end_time: string | null;
          topic: string | null;
          description: string | null;
          meeting_link: string | null;
          status: "scheduled" | "completed" | "cancelled" | "rescheduled";
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["class_sessions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["class_sessions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "class_sessions_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_sessions_trainer_id_fkey";
            columns: ["trainer_id"];
            isOneToOne: false;
            referencedRelation: "trainers";
            referencedColumns: ["id"];
          },
        ];
      };
      // Phase 22A — see 20260101000040_website_content_foundation.sql. Private
      // (Admin/Super Admin SELECT only); all writes go through the website_*
      // functions below. No fee, price or private Batch field exists here.
      website_display_groups: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          display_order: number;
          is_visible: boolean;
          archived_at: string | null;
          archived_by: string | null;
          version: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["website_display_groups"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["website_display_groups"]["Row"]>;
        Relationships: Relationships;
      };
      website_media_assets: {
        Row: {
          id: string;
          storage_bucket: "website-media";
          storage_path: string;
          mime_type: "image/jpeg" | "image/png" | "image/webp";
          byte_size: number;
          width: number | null;
          height: number | null;
          alt_text: string | null;
          status: "draft" | "approved" | "retired";
          approved_at: string | null;
          approved_by: string | null;
          version: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["website_media_assets"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["website_media_assets"]["Row"]>;
        Relationships: Relationships;
      };
      website_documents: {
        Row: {
          id: string;
          kind: WebsiteDocumentKind;
          page_key: string;
          program_id: string | null;
          slug: string | null;
          display_group_id: string | null;
          is_featured: boolean;
          featured_order: number | null;
          display_order: number | null;
          latest_revision_id: string | null;
          latest_revision_number: number;
          published_revision_id: string | null;
          published_at: string | null;
          published_by: string | null;
          first_published_at: string | null;
          unpublished_at: string | null;
          unpublished_by: string | null;
          version: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["website_documents"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["website_documents"]["Row"]>;
        Relationships: Relationships;
      };
      website_document_revisions: {
        Row: {
          id: string;
          document_id: string;
          revision_number: number;
          title: string;
          summary: string | null;
          seo_title: string | null;
          seo_description: string | null;
          social_title: string | null;
          social_description: string | null;
          hero_image_asset_id: string | null;
          social_image_asset_id: string | null;
          sections: unknown;
          restored_from_revision_id: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["website_document_revisions"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["website_document_revisions"]["Row"]
        >;
        Relationships: Relationships;
      };
      website_revision_media: {
        Row: {
          revision_id: string;
          asset_id: string;
        };
        Insert: Partial<Database["public"]["Tables"]["website_revision_media"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["website_revision_media"]["Row"]>;
        Relationships: Relationships;
      };
      website_program_slug_history: {
        Row: {
          id: string;
          document_id: string;
          old_slug: string;
          new_slug: string;
          changed_at: string;
          changed_by: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["website_program_slug_history"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["website_program_slug_history"]["Row"]
        >;
        Relationships: Relationships;
      };
      batch_website_publications: {
        Row: {
          batch_id: string;
          draft_public_label: string | null;
          draft_registration_state: WebsiteRegistrationState;
          is_published: boolean;
          published_label: string | null;
          published_registration_state: WebsiteRegistrationState | null;
          published_at: string | null;
          published_by: string | null;
          first_published_at: string | null;
          unpublished_at: string | null;
          unpublished_by: string | null;
          version: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["batch_website_publications"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["batch_website_publications"]["Row"]
        >;
        Relationships: Relationships;
      };
    };
    Views: {
      enrollment_summary: {
        Row: {
          id: string;
          enrollment_code: string;
          enrollment_status: string;
          enrollment_date: string;
          total_payable: string;
          student_id: string;
          student_code: string;
          student_first_name: string;
          student_last_name: string;
          program_id: string;
          program_code: string;
          program_name: string;
          batch_id: string | null;
          batch_name: string | null;
          batch_status: string | null;
        };
        Relationships: Relationships;
      };
      student_attendance_summary: {
        Row: {
          enrollment_id: string;
          student_id: string;
          batch_id: string;
          total_sessions: number;
          present_count: number;
          absent_count: number;
          late_count: number;
          excused_count: number;
          attendance_percentage: number | null;
        };
        Relationships: Relationships;
      };
    };
    Functions: {
      find_auth_account: {
        Args: { p_email: string };
        Returns: Array<{
          auth_user_id: string;
          has_password: boolean;
          last_sign_in_at: string | null;
          role: string | null;
          student_id: string | null;
          trainer_id: string | null;
          admin_id: string | null;
        }>;
      };
      auth_account_activity: {
        Args: { p_auth_user_ids: string[] };
        Returns: Array<{
          auth_user_id: string;
          has_password: boolean;
          last_sign_in_at: string | null;
        }>;
      };
      link_student_portal_account: {
        Args: { p_student_id: string; p_auth_user_id: string };
        Returns: string;
      };
      link_admin_account: {
        Args: {
          p_auth_user_id: string;
          p_first_name: string;
          p_last_name: string;
          p_email: string;
        };
        Returns: Array<{ admin_id: string | null; outcome: string }>;
      };
      set_admin_account_status: {
        Args: { p_admin_id: string; p_status: string };
        Returns: Array<{ auth_user_id: string | null; outcome: string }>;
      };
      assign_batch_trainer: {
        Args: {
          p_batch_id: string;
          p_trainer_id: string;
          p_is_primary: boolean;
        };
        Returns: string | null;
      };
      // Added for Phase 11 (Trainer Portal) — the first app-layer caller of
      // these two pre-existing SECURITY DEFINER functions
      // (supabase/migrations/20260101000017_replace_trainer_views_with_
      // hardened_functions.sql). Not previously declared here since nothing
      // in the app called them via supabase-js until this phase.
      trainer_visible_students: {
        Args: Record<PropertyKey, never>;
        Returns: {
          student_id: string;
          student_code: string;
          first_name: string;
          last_name: string;
          phone: string;
          email: string | null;
          batch_id: string;
        }[];
      };
      trainer_visible_enrollments: {
        Args: Record<PropertyKey, never>;
        Returns: {
          enrollment_id: string;
          enrollment_code: string;
          student_id: string;
          program_id: string;
          batch_id: string;
          status: string;
          enrollment_date: string;
        }[];
      };
      // Phase 17 (Certificates) — see 20260101000031_certificate_number_
      // generation.sql and 20260101000033_reissue_certificate_function.sql.
      generate_certificate_number: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      reissue_certificate: {
        Args: {
          p_original_id: string;
          p_new_certificate_number: string;
          p_new_pdf_path: string;
          p_reason: string | null;
        };
        Returns: string;
      };
      // Phase 21B — see 20260101000038_refund_workflow.sql.
      record_offline_refund: {
        Args: {
          p_refund_id: string;
          p_payment_id: string;
          p_amount: string;
          p_reason: string;
          p_refunded_on: string;
          p_reference: string | null;
        };
        Returns: { refund_id: string; already_recorded: boolean }[];
      };
      reserve_razorpay_refund: {
        Args: {
          p_refund_id: string;
          p_payment_id: string;
          p_amount: string;
          p_reason: string;
        };
        Returns: {
          refund_id: string;
          provider_payment_id: string;
          status: "initiated" | "processed" | "failed";
          razorpay_refund_id: string | null;
          already_reserved: boolean;
        }[];
      };
      // Phase 20A — see 20260101000035_offline_payments_ledger.sql.
      record_offline_payment: {
        Args: {
          p_payment_id: string;
          p_enrollment_id: string;
          p_amount: string;
          p_method: string;
          p_payment_type: string;
          p_paid_on: string;
          p_reference: string | null;
          p_notes: string | null;
        };
        Returns: {
          recorded_payment_id: string;
          recorded_payment_code: string;
          already_recorded: boolean;
        }[];
      };
      // Phase 22A — website management (each self-checks an active Admin /
      // Super Admin session; SQLSTATE 42501 not allowed, P2203 stale,
      // P2204 not found, P2205 slug taken/reserved, P2206 invalid state,
      // 22023 validation).
      website_create_display_group: {
        Args: { p_name: string; p_description: string | null };
        Returns: string;
      };
      website_update_display_group: {
        Args: {
          p_group_id: string;
          p_expected_version: number;
          p_name: string;
          p_description: string | null;
          p_is_visible: boolean;
        };
        Returns: number;
      };
      website_reorder_display_groups: {
        Args: { p_ordered_ids: string[] };
        Returns: undefined;
      };
      website_set_display_group_archived: {
        Args: { p_group_id: string; p_expected_version: number; p_archived: boolean };
        Returns: number;
      };
      website_create_page: {
        Args: { p_kind: Exclude<WebsiteDocumentKind, "program">; p_page_key: string };
        Returns: string;
      };
      website_create_program_document: {
        Args: { p_program_id: string; p_slug: string };
        Returns: string;
      };
      website_change_program_slug: {
        Args: { p_document_id: string; p_expected_version: number; p_new_slug: string };
        Returns: number;
      };
      website_update_program_placement: {
        Args: {
          p_document_id: string;
          p_expected_version: number;
          p_display_group_id: string | null;
          p_is_featured: boolean;
          p_display_order: number | null;
          p_featured_order: number | null;
        };
        Returns: number;
      };
      website_save_draft: {
        Args: {
          p_document_id: string;
          p_base_revision_number: number;
          p_title: string;
          p_summary: string | null;
          p_seo_title: string | null;
          p_seo_description: string | null;
          p_social_title: string | null;
          p_social_description: string | null;
          p_hero_image_asset_id: string | null;
          p_social_image_asset_id: string | null;
          p_sections: unknown;
        };
        Returns: { revision_id: string; revision_number: number }[];
      };
      website_restore_revision: {
        Args: {
          p_document_id: string;
          p_source_revision_id: string;
          p_base_revision_number: number;
        };
        Returns: { revision_id: string; revision_number: number }[];
      };
      website_publish_document: {
        Args: { p_document_id: string; p_revision_id: string };
        Returns: undefined;
      };
      website_unpublish_document: {
        Args: { p_document_id: string; p_expected_version: number };
        Returns: number;
      };
      website_discard_unpublished_document: {
        Args: { p_document_id: string; p_expected_version: number };
        Returns: undefined;
      };
      website_register_media_asset: {
        Args: {
          p_storage_path: string;
          p_mime_type: string;
          p_byte_size: number;
          p_width: number | null;
          p_height: number | null;
          p_alt_text: string | null;
        };
        Returns: string;
      };
      website_update_media_asset: {
        Args: {
          p_asset_id: string;
          p_expected_version: number;
          p_alt_text: string | null;
          p_status: string;
        };
        Returns: number;
      };
      website_save_batch_publication: {
        Args: {
          p_batch_id: string;
          p_expected_version: number;
          p_public_label: string | null;
          p_registration_state: WebsiteRegistrationState;
        };
        Returns: number;
      };
      website_publish_batch: {
        Args: { p_batch_id: string; p_expected_version: number };
        Returns: number;
      };
      website_unpublish_batch: {
        Args: { p_batch_id: string; p_expected_version: number };
        Returns: number;
      };
      // Phase 22A — 20260101000041_program_deletion_safeguards.sql. Active
      // Super Admin session only. delete_archived_program raises P2201
      // (detail = comma-separated blocker codes) when ineligible.
      program_deletion_blockers: {
        Args: { p_program_id: string };
        Returns: { code: string; detail: string }[];
      };
      delete_archived_program: {
        Args: { p_program_id: string; p_confirmation_code: string; p_reason: string };
        Returns: string;
      };
    };
  };
};
