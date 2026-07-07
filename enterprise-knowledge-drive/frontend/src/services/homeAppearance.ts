import api from './api';
import {
  HomeAppearanceConfig,
  HomeAppearanceConfigInput,
  mergeHomeAppearanceConfig,
} from '../config/homeAppearance';

type HomeAppearanceResponse = {
  value?: HomeAppearanceConfigInput | null;
  updated_at?: string | null;
};

export const getHomeAppearanceConfig = async (): Promise<{
  config: HomeAppearanceConfig;
  updatedAt: string | null;
}> => {
  const response = await api.get<HomeAppearanceResponse>('/admin/settings/home-appearance');
  return {
    config: mergeHomeAppearanceConfig(response.data?.value),
    updatedAt: response.data?.updated_at ?? null,
  };
};

export const saveHomeAppearanceConfig = async (config: HomeAppearanceConfig): Promise<{
  config: HomeAppearanceConfig;
  updatedAt: string | null;
}> => {
  const response = await api.put<HomeAppearanceResponse>('/admin/settings/home-appearance', {
    value: config,
  });
  return {
    config: mergeHomeAppearanceConfig(response.data?.value),
    updatedAt: response.data?.updated_at ?? null,
  };
};
