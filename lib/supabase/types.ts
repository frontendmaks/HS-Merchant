export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_products: {
        Row: {
          created_at: string
          custom_name: string | null
          custom_price: number | null
          feed_id: string
          id: string
          is_active: boolean
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          custom_price?: number | null
          feed_id: string
          id?: string
          is_active?: boolean
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          custom_price?: number | null
          feed_id?: string
          id?: string
          is_active?: boolean
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_products_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "feeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      feeds: {
        Row: {
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          last_generated_at: string | null
          marketplace_id: string
          name: string
          price_modifier: number
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["feed_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          last_generated_at?: string | null
          marketplace_id: string
          name: string
          price_modifier?: number
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["feed_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          last_generated_at?: string | null
          marketplace_id?: string
          name?: string
          price_modifier?: number
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["feed_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feeds_marketplace_id_fkey"
            columns: ["marketplace_id"]
            isOneToOne: false
            referencedRelation: "marketplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplaces: {
        Row: {
          base_url: string | null
          created_at: string
          format: Database["public"]["Enums"]["marketplace_format"]
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          format?: Database["public"]["Enums"]["marketplace_format"]
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          created_at?: string
          format?: Database["public"]["Enums"]["marketplace_format"]
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          attributes: Json
          barcode: string | null
          category_id: string | null
          country_of_origin: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          description: string | null
          external_id: string | null
          id: string
          images: Json
          name: string
          price: number
          price_old: number | null
          sku: string | null
          status: Database["public"]["Enums"]["product_status"]
          stock: number
          unit: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          attributes?: Json
          barcode?: string | null
          category_id?: string | null
          country_of_origin?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          description?: string | null
          external_id?: string | null
          id?: string
          images?: Json
          name: string
          price?: number
          price_old?: number | null
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          unit?: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          attributes?: Json
          barcode?: string | null
          category_id?: string | null
          country_of_origin?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          description?: string | null
          external_id?: string | null
          id?: string
          images?: Json
          name?: string
          price?: number
          price_old?: number | null
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          unit?: string
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      currency_code: "UAH" | "USD" | "EUR"
      feed_status: "active" | "inactive" | "draft"
      marketplace_format: "yml" | "rozetka_yml" | "prom_yml" | "maudau_yml"
      product_status: "active" | "inactive" | "out_of_stock"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      currency_code: ["UAH", "USD", "EUR"],
      feed_status: ["active", "inactive", "draft"],
      marketplace_format: ["yml", "rozetka_yml", "prom_yml", "maudau_yml"],
      product_status: ["active", "inactive", "out_of_stock"],
    },
  },
} as const
