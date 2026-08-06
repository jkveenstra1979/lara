/**
 * Databasetypes — handgeschreven, gelijk aan wat `supabase gen types typescript`
 * oplevert voor de migraties in supabase/migrations/.
 *
 * Zodra het Supabase-project bestaat kan dit bestand vervangen worden door:
 *
 *   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
 *
 * Tot die tijd is dit de enige plek waar het schema en de applicatie elkaar
 * raken; wijkt het af van de migratie, dan klopt de migratie.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      datasets: {
        Row: {
          id: string;
          filename: string;
          airac: string;
          storage_path: string | null;
          uploaded_at: string;
          uploaded_by: string | null;
          status: string;
          error_message: string | null;
          airspace_count: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          filename: string;
          airac: string;
          storage_path?: string | null;
          uploaded_at?: string;
          uploaded_by?: string | null;
          status?: string;
          error_message?: string | null;
          airspace_count?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          filename?: string;
          airac?: string;
          storage_path?: string | null;
          uploaded_at?: string;
          uploaded_by?: string | null;
          status?: string;
          error_message?: string | null;
          airspace_count?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };

      airspaces: {
        Row: {
          id: string;
          dataset_id: string;
          gml_id: string | null;
          uuid_identifier: string | null;
          ident: string;
          name: string | null;
          type: string | null;
          local_type: string | null;
          class: string | null;
          lowerlimit: number | null;
          lowerunit: string | null;
          upperlimit: number | null;
          upperunit: string | null;
          vertical_limits_json: Json | null;
          geometry: string | null;
          geometry_status: string | null;
          centroid_lat: number | null;
          centroid_lon: number | null;
          warnings_json: Json | null;
          raw_fragment: string | null;
        };
        Insert: {
          id?: string;
          dataset_id: string;
          gml_id?: string | null;
          uuid_identifier?: string | null;
          ident: string;
          name?: string | null;
          type?: string | null;
          local_type?: string | null;
          class?: string | null;
          lowerlimit?: number | null;
          lowerunit?: string | null;
          upperlimit?: number | null;
          upperunit?: string | null;
          vertical_limits_json?: Json | null;
          geometry?: string | null;
          geometry_status?: string | null;
          centroid_lat?: number | null;
          centroid_lon?: number | null;
          warnings_json?: Json | null;
          raw_fragment?: string | null;
        };
        Update: {
          id?: string;
          dataset_id?: string;
          gml_id?: string | null;
          uuid_identifier?: string | null;
          ident?: string;
          name?: string | null;
          type?: string | null;
          local_type?: string | null;
          class?: string | null;
          lowerlimit?: number | null;
          lowerunit?: string | null;
          upperlimit?: number | null;
          upperunit?: string | null;
          vertical_limits_json?: Json | null;
          geometry?: string | null;
          geometry_status?: string | null;
          centroid_lat?: number | null;
          centroid_lon?: number | null;
          warnings_json?: Json | null;
          raw_fragment?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "airspaces_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };

      geometries: {
        Row: {
          id: string;
          airspace_id: string;
          geojson: Json | null;
          bbox: Json | null;
          geom_type: string | null;
          operation: string | null;
          operation_sequence: number | null;
          geometry_status: string | null;
          lowerlimit: number | null;
          lowerunit: string | null;
          upperlimit: number | null;
          upperunit: string | null;
          derived_from: Json | null;
        };
        Insert: {
          id?: string;
          airspace_id: string;
          geojson?: Json | null;
          bbox?: Json | null;
          geom_type?: string | null;
          operation?: string | null;
          operation_sequence?: number | null;
          geometry_status?: string | null;
          lowerlimit?: number | null;
          lowerunit?: string | null;
          upperlimit?: number | null;
          upperunit?: string | null;
          derived_from?: Json | null;
        };
        Update: {
          id?: string;
          airspace_id?: string;
          geojson?: Json | null;
          bbox?: Json | null;
          geom_type?: string | null;
          operation?: string | null;
          operation_sequence?: number | null;
          geometry_status?: string | null;
          lowerlimit?: number | null;
          lowerunit?: string | null;
          upperlimit?: number | null;
          upperunit?: string | null;
          derived_from?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "geometries_airspace_id_fkey";
            columns: ["airspace_id"];
            isOneToOne: false;
            referencedRelation: "airspaces";
            referencedColumns: ["id"];
          },
        ];
      };

      lara_areas: {
        Row: {
          id: string;
          dataset_id: string;
          airspace_id: string;
          lara_area_id: number | null;
          note: string | null;
          added_at: string;
          added_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          dataset_id: string;
          airspace_id: string;
          lara_area_id?: number | null;
          note?: string | null;
          added_at?: string;
          added_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          dataset_id?: string;
          airspace_id?: string;
          lara_area_id?: number | null;
          note?: string | null;
          added_at?: string;
          added_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lara_areas_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lara_areas_airspace_id_fkey";
            columns: ["airspace_id"];
            isOneToOne: false;
            referencedRelation: "airspaces";
            referencedColumns: ["id"];
          },
        ];
      };

      xml_snippets: {
        Row: {
          dataset_id: string;
          uuid: string;
          snippet: string;
        };
        Insert: {
          dataset_id: string;
          uuid: string;
          snippet: string;
        };
        Update: {
          dataset_id?: string;
          uuid?: string;
          snippet?: string;
        };
        Relationships: [
          {
            foreignKeyName: "xml_snippets_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };

      gebruikers: {
        Row: {
          id: string;
          email: string;
          naam: string | null;
          rol: "admin" | "user";
          created_at: string;
          last_seen: string | null;
        };
        Insert: {
          id: string;
          email: string;
          naam?: string | null;
          rol?: "admin" | "user";
          created_at?: string;
          last_seen?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          naam?: string | null;
          rol?: "admin" | "user";
          created_at?: string;
          last_seen?: string | null;
        };
        Relationships: [];
      };

      uitnodigingen: {
        Row: {
          id: string;
          email: string;
          rol: "admin" | "user";
          naam: string | null;
          token: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          rol?: "admin" | "user";
          naam?: string | null;
          token?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          rol?: "admin" | "user";
          naam?: string | null;
          token?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "uitnodigingen_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "gebruikers";
            referencedColumns: ["id"];
          },
        ];
      };

      geoborders: {
        Row: {
          id: string;
          border_id: string;
          name: string | null;
          geojson: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          border_id: string;
          name?: string | null;
          geojson: Json;
          updated_at?: string;
        };
        Update: {
          id?: string;
          border_id?: string;
          name?: string | null;
          geojson?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/* --------------------------------------------------------------- gemak ---- */

type Tabellen = Database["public"]["Tables"];

export type Dataset = Tabellen["datasets"]["Row"];
export type Airspace = Tabellen["airspaces"]["Row"];
export type Geometrie = Tabellen["geometries"]["Row"];
export type LaraArea = Tabellen["lara_areas"]["Row"];
export type XmlSnippet = Tabellen["xml_snippets"]["Row"];
export type Geoborder = Tabellen["geoborders"]["Row"];
export type GebruikerRij = Tabellen["gebruikers"]["Row"];

/** De status van een import, zoals de check-constraint hem toestaat. */
export type DatasetStatus = "queued" | "running" | "done" | "error";

// De toegestane waarden van geometries.operation staan in lib/airspaceVolumes.ts
// (VOLUME_OPERATIES). Daar horen ze thuis: dat is ook de plek die ze uit AIXM
// leest, en één definitie voorkomt dat de twee uit elkaar lopen.
