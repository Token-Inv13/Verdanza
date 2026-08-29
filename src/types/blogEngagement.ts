export type BlogCommentStatus = "pending" | "approved" | "rejected";

export type BlogEngagementSummary = {
  slug: string;
  likeCount: number;
  viewerLiked: boolean;
  approvedCommentCount: number;
};

export type BlogComment = {
  id: string;
  slug: string;
  status: BlogCommentStatus;
  displayName: string;
  text: string;
  createdAt: string;
};

export type AdminBlogComment = BlogComment & {
  userId: string;
  updatedAt?: string;
  moderatedAt?: string;
  moderatedBy?: string;
};

export type BlogCommentsPage = {
  comments: BlogComment[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type AdminBlogCommentsPage = {
  comments: AdminBlogComment[];
  total: number;
  page: number;
  pageSize: number;
};
