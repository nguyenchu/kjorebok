export interface Place {
  id: string;
  label: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface CreatePlaceDto {
  label: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
}

export interface UpdatePlaceDto {
  label?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}
