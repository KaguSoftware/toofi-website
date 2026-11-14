/**
 * Hand-written to match supabase/migrations/*.sql, in the shape `supabase gen types typescript` emits.
 * Once a project is linked you can replace this file with the generated one:
 *   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string;
          role: Database["public"]["Enums"]["app_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string;
          name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pages: {
        Row: {
          id: string;
          slug: string;
          title: string;
          template: string;
          status: string;
          seo: Json;
          created_at: string;
          updated_at: string;
          published_at: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          template: string;
          status?: string;
          seo?: Json;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          slug?: string;
          title?: string;
          template?: string;
          status?: string;
          seo?: Json;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
          created_by?: string | null;
        };
        Relationships: [];
      };
      content_blocks: {
        Row: {
          id: string;
          page_id: string | null;
          /** Generated: page_id::text, or 'global'. */
          scope: string;
          key: string;
          type: string;
          draft: Json | null;
          published: Json | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          page_id?: string | null;
          key: string;
          type: string;
          draft?: Json | null;
          published?: Json | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          page_id?: string | null;
          key?: string;
          type?: string;
          draft?: Json | null;
          published?: Json | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_blocks_page_id_fkey";
            columns: ["page_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id"];
          },
        ];
      };
      content_revisions: {
        Row: {
          id: string;
          block_id: string;
          type: string;
          value: Json;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          block_id: string;
          type: string;
          value: Json;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          block_id?: string;
          type?: string;
          value?: Json;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "content_revisions_block_id_fkey";
            columns: ["block_id"];
            isOneToOne: false;
            referencedRelation: "content_blocks";
            referencedColumns: ["id"];
          },
        ];
      };
      media: {
        Row: {
          id: string;
          storage_path: string;
          url: string;
          filename: string;
          content_type: string;
          size: number;
          width: number | null;
          height: number | null;
          alt: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          storage_path: string;
          url: string;
          filename: string;
          content_type: string;
          size: number;
          width?: number | null;
          height?: number | null;
          alt?: string;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          storage_path?: string;
          url?: string;
          filename?: string;
          content_type?: string;
          size?: number;
          width?: number | null;
          height?: number | null;
          alt?: string;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      published_content: {
        Row: {
          id: string | null;
          page_id: string | null;
          scope: string | null;
          key: string | null;
          type: string | null;
          published: Json | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      has_permission: { Args: { p: string }; Returns: boolean };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      validate_block_value: { Args: { t: string; v: Json }; Returns: boolean };
      save_drafts: { Args: { changes: Json }; Returns: undefined };
      publish_scopes: { Args: { scopes: string[] }; Returns: number };
      discard_drafts: { Args: { scopes: string[] }; Returns: undefined };
      restore_revision: { Args: { revision_id: string }; Returns: undefined };
    };
    Enums: {
      app_role: "member" | "viewer" | "editor" | "admin";
    };
    CompositeTypes: Record<string, never>;
  };
};
