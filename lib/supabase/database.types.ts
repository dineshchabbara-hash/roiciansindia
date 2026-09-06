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
          status: "active" | "inactive" | "archived";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["students"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["students"]["Row"]>;
        Relationships: Relationships;
      };
      trainers: {
        Row: {
          id: string;
          auth_user_id: string;
          first_name: string;
          last_name: string;
          status: "active" | "inactive";
        };
        Insert: Partial<Database["public"]["Tables"]["trainers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["trainers"]["Row"]>;
        Relationships: Relationships;
      };
      programs: {
        Row: {
          id: string;
          program_code: string;
          name: string;
          status: "draft" | "active" | "inactive" | "archived";
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
          status:
            "draft" | "upcoming" | "active" | "completed" | "cancelled" | "archived";
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
    };
    Functions: Record<string, never>;
  };
};
