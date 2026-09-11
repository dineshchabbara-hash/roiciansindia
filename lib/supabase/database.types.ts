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
        };
        Insert: Partial<Database["public"]["Tables"]["admins"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["admins"]["Row"]>;
        Relationships: Relationships;
      };
      company_settings: {
        Row: {
          id: string;
          company_name: string;
          legal_name: string;
          logo_path: string | null;
          default_tax_rate_percent: string;
          tax_label: string;
          program_code_pattern: string | null;
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
          marked_at: string;
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
            | "registered"
            | "enrolled"
            | "active"
            | "on_hold"
            | "completed"
            | "withdrawn"
            | "cancelled";
          total_payable: string;
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
        ];
      };
      payment_refunds: {
        Row: {
          id: string;
          payment_id: string;
          amount: string;
          status: "initiated" | "processed" | "failed";
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
          status: "scheduled" | "completed" | "cancelled" | "rescheduled";
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
    Functions: Record<string, never>;
  };
};
