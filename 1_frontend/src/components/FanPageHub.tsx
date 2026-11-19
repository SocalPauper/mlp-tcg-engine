import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './FanPageHub.css';

interface ForumPost {
  id: string;
  author_id: string;
  author_name: string;
  category: string;
  title: string;
  body: string;
  image_url: string | null;
  visible_image_url: string | null;
  image_status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  upvotes: number;
  downvotes: number;
  comment_count: number;
  is_pinned: boolean;
  created_at: string;
}

interface ForumComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_name: string;
  body: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
}

interface FanPageHubProps {
  currentUser: {
    id?: string | number;
    username?: string;
    displayName?: string;
    isSafeMode?: boolean;
    is_admin?: boolean;
    isAdmin?: boolean;
    role?: string;
  } | null;
}

const CATEGORIES = ['ALL', 'General', 'Deck Tech', 'Pulls & Binder', 'Fan Art', 'Rules Q&A'];

export default function FanPageHub({ currentUser }: FanPageHubProps) {
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [category, setCategory] = useState<string>('ALL');
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const [loading, setLoading] = useState(false);

  // Create Thread Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [newBody, setNewBody] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Active Thread & Comments
  const [activePost, setActivePost] = useState<ForumPost | null>(null);
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [replyText, setReplyText] = useState('');
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [commentError, setCommentError] = useState('');

  // Admin Pending Posts Review Modal
  const [pendingImages, setPendingImages] = useState<ForumPost[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);

  const isLoggedIn = Boolean(currentUser?.id);
  const isSafeMode = Boolean(currentUser?.isSafeMode);
  const canParticipate = isLoggedIn && !isSafeMode;
  const isAdmin = Boolean(
    currentUser?.is_admin ||
    currentUser?.isAdmin ||
    currentUser?.role === 'admin' ||
    String(currentUser?.username || '').toLowerCase() === 'bigmeatypawz'
  );

  const getAuthHeaders = (includeJson = false): Record<string, string> => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/forum/posts?category=${encodeURIComponent(category)}&sort=${sort}`,
        { headers: getAuthHeaders(), credentials: 'include' }
      );
      if (res.ok) {
        setPosts(await res.json());
      }
    } catch (err) {
      console.error('Error loading forum posts:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingImages = async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/forum/admin/pending-images`, {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const list = await res.json();
        setPendingImages(Array.isArray(list) ? list : []);
        setReviewIndex(0);
      }
    } catch (err) {
      console.error('Error loading pending images:', err);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [category, sort]);

  useEffect(() => {
    fetchPendingImages();
  }, [isAdmin]);

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Please select a valid image file (PNG, JPG, WebP, GIF).');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormError('Image file must be under 4 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNewImageUrl(reader.result);
        setFormError('');
      }
    };
    reader.readAsDataURL(file);
  };

  const openThread = async (post: ForumPost) => {
    setActivePost(post);
    setCommentError('');
    setReplyParentId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/forum/posts/${post.id}`, {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setActivePost(data.post);
        setComments(data.comments || []);
      }
    } catch (err) {
      console.error('Failed to open thread:', err);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    let normalizedImg = newImageUrl.trim();
    if (normalizedImg && !normalizedImg.startsWith('data:image/') && !/^https?:\/\//i.test(normalizedImg)) {
      normalizedImg = `https://${normalizedImg}`;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/forum/posts`, {
        method: 'POST',
        headers: getAuthHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          title: newTitle,
          category: newCategory,
          body: newBody,
          image_url: normalizedImg || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || 'Post blocked by safety filter.');
        setSubmitting(false);
        return;
      }

      if (data.pendingImageApproval) {
        alert('Thread published! Your attached image is queued for Administrator approval before public display.');
      }

      setNewTitle('');
      setNewBody('');
      setNewImageUrl('');
      setShowCreateModal(false);
      fetchPosts();
      if (isAdmin) fetchPendingImages();
    } catch {
      setFormError('Network error while publishing post.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (targetId: string, targetType: 'post' | 'comment', value: 1 | -1) => {
    if (!canParticipate) {
      alert('Registered non-Safe Mode accounts are required to vote.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/forum/vote`, {
        method: 'POST',
        headers: getAuthHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ targetId, targetType, value }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (targetType === 'post') {
          setPosts((prev) =>
            prev.map((p) =>
              p.id === targetId ? { ...p, upvotes: updated.upvotes, downvotes: updated.downvotes } : p
            )
          );
          if (activePost?.id === targetId) {
            setActivePost({ ...activePost, upvotes: updated.upvotes, downvotes: updated.downvotes });
          }
        } else {
          setComments((prev) =>
            prev.map((c) =>
              c.id === targetId ? { ...c, upvotes: updated.upvotes, downvotes: updated.downvotes } : c
            )
          );
        }
      }
    } catch (err) {
      console.error('Vote failed:', err);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePost || !replyText.trim()) return;
    setCommentError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/forum/posts/${activePost.id}/comments`, {
        method: 'POST',
        headers: getAuthHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ body: replyText, parent_id: replyParentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCommentError(data.message || 'Reply blocked by safety filter.');
        return;
      }
      setComments((prev) => [...prev, data.comment]);
      setReplyText('');
      setReplyParentId(null);
      fetchPosts();
    } catch {
      setCommentError('Failed to post reply.');
    }
  };

  const handleModerateImage = async (postId: string, action: 'APPROVE' | 'REJECT') => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/forum/admin/moderate-image/${postId}`, {
        method: 'POST',
        headers: getAuthHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const nextList = pendingImages.filter((p) => p.id !== postId);
        setPendingImages(nextList);
        setReviewIndex((prev) => (nextList.length === 0 ? 0 : Math.min(prev, nextList.length - 1)));
        fetchPosts();
        if (activePost?.id === postId) {
          setActivePost({
            ...activePost,
            image_status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            visible_image_url: action === 'APPROVE' ? activePost.image_url : null,
          });
        }
      }
    } catch (err) {
      console.error('Moderation error:', err);
    }
  };

  const renderCommentTree = (parentId: string | null = null, depth = 0) => {
    const branch = comments.filter((c) => (c.parent_id || null) === parentId);
    if (branch.length === 0) return null;

    return branch.map((c) => (
      <div key={c.id} className={`forum-comment-branch ${depth > 0 ? 'nested' : ''}`}>
        <div className="forum-comment-box">
          <div style={{ fontSize: '12px', color: '#ffd700', fontWeight: 800, marginBottom: '4px' }}>
            {c.author_name} •{' '}
            <span style={{ color: '#c4b5fd', fontWeight: 600 }}>
              {new Date(c.created_at).toLocaleString()}
            </span>
          </div>
          <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#fce7f3', whiteSpace: 'pre-wrap' }}>
            {c.body}
          </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '12px' }}>
            <button
              className="vote-arrow-btn up"
              style={{ fontSize: '12px' }}
              onClick={() => handleVote(c.id, 'comment', 1)}
            >
              ▲ {c.upvotes}
            </button>
            <button
              className="vote-arrow-btn down"
              style={{ fontSize: '12px' }}
              onClick={() => handleVote(c.id, 'comment', -1)}
            >
              ▼ {c.downvotes}
            </button>
            {canParticipate && (
              <button
                onClick={() => setReplyParentId(c.id)}
                style={{ background: 'none', border: 'none', color: '#f9a8d4', cursor: 'pointer', fontWeight: 800 }}
              >
                💬 Reply
              </button>
            )}
          </div>
        </div>
        {renderCommentTree(c.id, depth + 1)}
      </div>
    ));
  };

  const currentReviewItem = pendingImages[reviewIndex] || null;

  return (
    <div className="fanpage-container">
      <div className="fanpage-wrapper">
        {/* Header */}
        <div className="fanpage-header">
          <div>
            <h1>📜 Equestrian Fan Forum</h1>
            <span className="fanpage-subtitle">
              Share deck techs, tournament stories, binder pulls, and community art
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            {isAdmin && (
              <button
                className="stable-tab-btn"
                style={{
                  borderColor: '#ffd700',
                  color: pendingImages.length > 0 ? '#180826' : '#ffd700',
                  background: pendingImages.length > 0
                    ? 'linear-gradient(135deg, #ffd700 0%, #f59e0b 100%)'
                    : 'rgba(45, 16, 70, 0.75)',
                  fontWeight: 900,
                }}
                onClick={() => {
                  fetchPendingImages();
                  setShowReviewModal(true);
                }}
              >
                🛡️ View Pending Posts ({pendingImages.length})
              </button>
            )}
            {canParticipate ? (
              <button className="build-new-btn" onClick={() => setShowCreateModal(true)}>
                ✍️ Create Thread ✨
              </button>
            ) : (
              <div className="fanpage-lock-pill">
                {isSafeMode
                  ? '🔒 Safe Mode Active (Verify Email to Post)'
                  : '🔒 Sign in to Create Threads & Vote'}
              </div>
            )}
          </div>
        </div>

        {/* Filter & Sort Controls */}
        <div className="fanpage-toolbar">
          <div className="fanpage-pill-group">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`stable-tab-btn ${category === cat ? 'active' : ''}`}
                onClick={() => {
                  setActivePost(null);
                  setCategory(cat);
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="fanpage-pill-group">
            <button
              className={`stable-tab-btn ${sort === 'new' ? 'active' : ''}`}
              onClick={() => setSort('new')}
            >
              🆕 Newest
            </button>
            <button
              className={`stable-tab-btn ${sort === 'top' ? 'active' : ''}`}
              onClick={() => setSort('top')}
            >
              🔥 Top Voted
            </button>
          </div>
        </div>

        {/* Thread Detail View OR Feed */}
        {activePost ? (
          <div className="forum-thread-detail">
            <button
              className="stable-tab-btn"
              style={{ marginBottom: '16px' }}
              onClick={() => setActivePost(null)}
            >
              ← Back to Forum Feed
            </button>

            <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start' }}>
              <div className="forum-vote-col">
                <button className="vote-arrow-btn up" onClick={() => handleVote(activePost.id, 'post', 1)}>
                  ▲
                </button>
                <span className="vote-score">{activePost.upvotes - activePost.downvotes}</span>
                <button className="vote-arrow-btn down" onClick={() => handleVote(activePost.id, 'post', -1)}>
                  ▼
                </button>
              </div>

              <div className="forum-post-main">
                <div className="forum-meta-row">
                  <span className="forum-category-badge">{activePost.category}</span>
                  <span className="forum-author-text">
                    Posted by <strong>{activePost.author_name}</strong> •{' '}
                    {new Date(activePost.created_at).toLocaleString()}
                  </span>
                </div>

                <h2 style={{ margin: '6px 0 12px 0', color: '#fff', fontSize: '23px' }}>{activePost.title}</h2>

                {activePost.visible_image_url && (
                  <div style={{ marginBottom: '12px' }}>
                    {activePost.image_status === 'PENDING' && (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <span className="forum-pending-badge">
                          ⏳ Image Pending Administrator Approval (Only visible to you & admins)
                        </span>
                        {isAdmin && (
                          <>
                            <button
                              className="deck-action-btn btn-primary"
                              style={{ flex: '0 0 auto', padding: '4px 14px' }}
                              onClick={() => handleModerateImage(activePost.id, 'APPROVE')}
                            >
                              Accept Image ✅
                            </button>
                            <button
                              className="deck-action-btn btn-danger"
                              style={{ flex: '0 0 auto', padding: '4px 14px' }}
                              onClick={() => handleModerateImage(activePost.id, 'REJECT')}
                            >
                              Reject Image ❌
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <img
                      src={activePost.visible_image_url}
                      alt={activePost.title}
                      className="forum-full-image"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}

                <p style={{ color: '#fce7f3', fontSize: '15px', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                  {activePost.body}
                </p>
              </div>
            </div>

            <hr style={{ borderColor: 'rgba(255, 158, 187, 0.25)', margin: '22px 0' }} />

            {canParticipate && (
              <form onSubmit={handlePostComment} style={{ marginBottom: '22px' }}>
                {replyParentId && (
                  <div style={{ fontSize: '12px', color: '#ffd700', marginBottom: '6px' }}>
                    Replying to comment •{' '}
                    <button
                      type="button"
                      onClick={() => setReplyParentId(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#fda4af',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <textarea
                  rows={3}
                  className="forum-textarea"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a respectful reply..."
                />
                {commentError && <div className="forum-error-banner">⚠️ {commentError}</div>}
                <button type="submit" className="build-new-btn" style={{ padding: '9px 22px', fontSize: '13.5px' }}>
                  Post Reply 💬
                </button>
              </form>
            )}

            <h3 style={{ color: '#ffd700', margin: '0 0 8px 0' }}>Comments ({comments.length})</h3>
            {comments.length === 0 ? (
              <p style={{ color: '#c4b5fd' }}>No replies yet. Start the conversation!</p>
            ) : (
              renderCommentTree(null, 0)
            )}
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#ffd700', fontSize: '18px' }}>
            <strong>Loading Forum Threads... ✨</strong>
          </div>
        ) : (
          <div className="fanpage-feed">
            {posts.map((post) => (
              <div key={post.id} className="forum-post-card" onClick={() => openThread(post)}>
                <div className="forum-vote-col" onClick={(e) => e.stopPropagation()}>
                  <button className="vote-arrow-btn up" onClick={() => handleVote(post.id, 'post', 1)}>
                    ▲
                  </button>
                  <span className="vote-score">{post.upvotes - post.downvotes}</span>
                  <button className="vote-arrow-btn down" onClick={() => handleVote(post.id, 'post', -1)}>
                    ▼
                  </button>
                </div>

                <div className="forum-post-main">
                  <div className="forum-meta-row">
                    <span className="forum-category-badge">{post.category}</span>
                    <span className="forum-author-text">
                      Posted by <strong>{post.author_name}</strong> •{' '}
                      {new Date(post.created_at).toLocaleDateString()}
                    </span>
                    {post.image_status === 'PENDING' && (
                      <span className="forum-pending-badge">⏳ Image Awaiting Admin Approval</span>
                    )}
                  </div>
                  <h3 className="forum-post-title">{post.title}</h3>
                  <p className="forum-post-excerpt">{post.body}</p>
                  <div style={{ fontSize: '12.5px', color: '#ffd700', fontWeight: 800 }}>
                    💬 {post.comment_count || 0} Comments
                  </div>
                </div>

                {post.visible_image_url && (
                  <img
                    src={post.visible_image_url}
                    alt="Thumbnail"
                    className="forum-post-thumb"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
              </div>
            ))}

            {posts.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px',
                  color: '#fbcfe8',
                  background: 'rgba(36, 12, 56, 0.55)',
                  borderRadius: '26px',
                  border: '2px dashed rgba(255, 158, 187, 0.45)',
                }}
              >
                No threads in this category yet. Be the first to start a discussion!
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step-by-Step Admin Review Modal for Pending Image Posts */}
      {isAdmin && showReviewModal && (
        <div className="forum-modal-overlay" onClick={() => setShowReviewModal(false)}>
          <div className="forum-modal-card" style={{ width: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, color: '#ffd700' }}>
                🛡️ Pending Image Approvals ({pendingImages.length})
              </h2>
              <button className="stable-tab-btn" onClick={() => setShowReviewModal(false)}>
                ✕ Close
              </button>
            </div>

            {!currentReviewItem ? (
              <div style={{ textAlign: 'center', padding: '32px 12px', color: '#e9d5ff' }}>
                <p style={{ fontSize: '16px', fontWeight: 800, marginBottom: '6px' }}>
                  All caught up! ✨
                </p>
                <p style={{ fontSize: '13px', margin: 0 }}>
                  There are no pending user images awaiting administrator approval.
                </p>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontSize: '12.5px', color: '#c4b5fd' }}>
                  <span>
                    Reviewing <strong>{reviewIndex + 1}</strong> of <strong>{pendingImages.length}</strong>
                  </span>
                  <span>
                    Posted by <strong>{currentReviewItem.author_name}</strong> in <strong>{currentReviewItem.category}</strong>
                  </span>
                </div>

                <div style={{ background: '#140522', borderRadius: '16px', padding: '14px', border: '1.5px solid rgba(255,158,187,0.4)', marginBottom: '14px' }}>
                  <h3 style={{ margin: '0 0 6px 0', color: '#fff', fontSize: '17px' }}>{currentReviewItem.title}</h3>
                  <p style={{ margin: '0 0 12px 0', color: '#fbcfe8', fontSize: '13px', maxHeight: '70px', overflowY: 'auto' }}>
                    {currentReviewItem.body}
                  </p>
                  <div style={{ textAlign: 'center', background: '#0b0314', borderRadius: '12px', padding: '10px' }}>
                    <img
                      src={currentReviewItem.image_url || ''}
                      alt="Pending submission"
                      style={{ maxWidth: '100%', maxHeight: '280px', borderRadius: '10px' }}
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        img.style.display = 'none';
                        const fallback = img.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = 'block';
                      }}
                    />
                    <div style={{ display: 'none', color: '#fda4af', fontSize: '12.5px', padding: '12px', wordBreak: 'break-all' }}>
                      ⚠️ Not a direct image file: <strong>{currentReviewItem.image_url}</strong>
                      <br />
                      <span style={{ color: '#c4b5fd', fontSize: '11px' }}>
                        (Click Reject to remove the broken attachment while keeping the text post)
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="stable-tab-btn"
                      disabled={pendingImages.length <= 1}
                      onClick={() => setReviewIndex((prev) => (prev - 1 + pendingImages.length) % pendingImages.length)}
                    >
                      ◀ Prev
                    </button>
                    <button
                      className="stable-tab-btn"
                      disabled={pendingImages.length <= 1}
                      onClick={() => setReviewIndex((prev) => (prev + 1) % pendingImages.length)}
                    >
                      Next ▶
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      className="deck-action-btn btn-danger"
                      style={{ padding: '10px 20px' }}
                      onClick={() => handleModerateImage(currentReviewItem.id, 'REJECT')}
                    >
                      Reject ❌
                    </button>
                    <button
                      className="deck-action-btn btn-primary"
                      style={{ padding: '10px 20px' }}
                      onClick={() => handleModerateImage(currentReviewItem.id, 'APPROVE')}
                    >
                      Accept ✅
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Thread Modal */}
      {showCreateModal && (
        <div className="forum-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <form className="forum-modal-card" onSubmit={handleCreatePost} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px 0', color: '#ffd700' }}>✍️ Create New Forum Thread</h2>

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, marginBottom: '4px' }}>
              Category
            </label>
            <select
              className="forum-select"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {CATEGORIES.filter((c) => c !== 'ALL').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, marginBottom: '4px' }}>
              Thread Title
            </label>
            <input
              type="text"
              required
              className="forum-input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Enter an engaging title..."
            />

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, marginBottom: '4px' }}>
              Post Body
            </label>
            <textarea
              rows={5}
              required
              className="forum-textarea"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Share your thoughts, decklist insights, or story..."
            />

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, marginBottom: '4px' }}>
              Optional Image Attachment (Requires Administrator Approval before public display)
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageFileSelect}
                style={{ fontSize: '12px', color: '#fbcfe8' }}
              />
              {newImageUrl && (
                <button
                  type="button"
                  className="stable-tab-btn"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  onClick={() => setNewImageUrl('')}
                >
                  Clear Image ✕
                </button>
              )}
            </div>
            <input
              type="text"
              className="forum-input"
              value={newImageUrl.startsWith('data:image/') ? '[Local Image Selected]' : newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              disabled={newImageUrl.startsWith('data:image/')}
              placeholder="Or paste direct image link (https://example.com/photo.png)"
            />

            {formError && <div className="forum-error-banner">⚠️ {formError}</div>}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="stable-tab-btn"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="build-new-btn" disabled={submitting}>
                {submitting ? 'Publishing...' : 'Publish Thread ✨'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}